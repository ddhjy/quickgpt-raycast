import * as fs from "fs";
import * as path from "path";
import { environment, type Cache } from "@raycast/api";
import * as temporaryDirectoryStore from "../stores/temporary-directory-store";
import configurationManager from "./configuration-manager";
import { createNamespacedCache } from "../utils/extension-cache";
import {
  createPromptParseState,
  parsePromptsFromFile,
  processPrompts,
  type PromptParseState,
  type PromptProps,
} from "../utils/prompt-parsing";

export type { PromptProps } from "../utils/prompt-parsing";

const READ_CONCURRENCY = 16;

export function isPathInsideDirectory(filePath: string, directoryPath: string): boolean {
  const relativePath = path.relative(directoryPath, filePath);
  return (
    relativePath !== "" &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  );
}

function isPromptFile(filePath: string): boolean {
  return path.basename(filePath).toLowerCase().endsWith(".hjson");
}

class PromptManager {
  private prompts: PromptProps[] = [];
  private temporaryDirectoryPaths: string[] = [];
  // v3: cached prompts include `sourceIndexPath` and `hasOwnContent` for the
  // Prompt Map editor; bumping the namespace forces a one-time re-parse so
  // stale payloads without those fields are discarded.
  private cache: Cache = createNamespacedCache(`prompts-v3-${environment.commandName}`);
  private readonly CACHE_KEY_DATA = "prompts_data_v3";
  private readonly listeners = new Set<(promptsChanged: boolean) => void>();
  // Serialized form of the loaded library, used to tell whether a re-read changed anything.
  private snapshot = "";
  private isSnapshotCached = false;
  private activeRefresh?: Promise<void>;

  constructor() {
    this.hydrateCachedPrompts();
  }

  /**
   * Shows the previous session's library immediately; `refreshPrompts`
   * re-reads the files afterwards and replaces it when they changed.
   */
  private hydrateCachedPrompts(): void {
    const cachedData = this.cache.get(this.CACHE_KEY_DATA);
    if (!cachedData) {
      return;
    }

    try {
      const parsedData = JSON.parse(cachedData);
      this.prompts = Array.isArray(parsedData.prompts) ? parsedData.prompts : [];
      this.snapshot = cachedData;
      this.isSnapshotCached = true;
    } catch {
      this.cache.remove(this.CACHE_KEY_DATA);
    }
  }

  public subscribe(listener: (promptsChanged: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public hasPrompts(): boolean {
    return this.prompts.length > 0;
  }

  private getPromptFilePaths(): string[] {
    const allPaths = [...configurationManager.getDirectories("prompts")];

    this.temporaryDirectoryPaths = temporaryDirectoryStore.getActiveTemporaryDirectories().map((dir) => dir.path);
    allPaths.push(...this.temporaryDirectoryPaths);

    if (allPaths.length === 0) {
      allPaths.push(path.join(__dirname, "assets/prompts.hjson"));
    }

    allPaths.push(path.join(__dirname, "assets/system_prompts.hjson"));

    return Array.from(new Set(allPaths));
  }

  private parsePromptsFromFile(state: PromptParseState, data: string, filePath: string): PromptProps[] {
    try {
      const prompts = parsePromptsFromFile(state, data, filePath);
      const tempDirSource = this.temporaryDirectoryPaths.find((tempDir) => isPathInsideDirectory(filePath, tempDir));
      if (tempDirSource === undefined) {
        return prompts;
      }
      return prompts.map((prompt) => {
        prompt.isTemporary = true;
        prompt.temporaryDirSource = tempDirSource;
        return prompt;
      });
    } catch (error) {
      console.error(`Failed to process prompt file ${filePath}:`, error);
      return [];
    }
  }

  private loadAllPrompts(force = false): Promise<void> {
    if (this.activeRefresh) {
      // A forced reload must see configuration changes made after the running
      // refresh started, so it runs again once that refresh settles.
      return force
        ? this.activeRefresh.catch(() => undefined).then(() => this.loadAllPrompts(true))
        : this.activeRefresh;
    }

    const refresh = this.performLoadAllPrompts().finally(() => {
      if (this.activeRefresh === refresh) {
        this.activeRefresh = undefined;
      }
    });
    this.activeRefresh = refresh;
    return refresh;
  }

  private async performLoadAllPrompts(): Promise<void> {
    const hadPreviousPrompts = this.prompts.length > 0;
    let promptsChanged = false;

    try {
      const { files, unreadableCount } = await this.readPromptFiles(this.getPromptFilePaths());

      // An unreadable path would silently drop its prompts, so keep what is
      // already loaded. Only a cold start accepts a partial library.
      if (unreadableCount > 0 && hadPreviousPrompts) {
        throw new Error(`Prompt scan skipped ${unreadableCount} unreadable path(s)`);
      }

      const parseState = createPromptParseState();
      const loadedPrompts = files.flatMap(({ filePath, data }) =>
        this.parsePromptsFromFile(parseState, data, filePath),
      );
      const prompts = processPrompts(parseState, loadedPrompts);
      const snapshot = JSON.stringify({ prompts, mergedRootProperties: parseState.mergedRootProperties });

      if (snapshot !== this.snapshot) {
        this.prompts = prompts;
        this.snapshot = snapshot;
        this.isSnapshotCached = false;
        promptsChanged = true;
      }

      // A partial library is never cached, so the next launch starts from a complete one.
      if (unreadableCount === 0 && !this.isSnapshotCached) {
        try {
          this.cache.set(this.CACHE_KEY_DATA, snapshot);
          this.isSnapshotCached = true;
        } catch (error) {
          console.error("Failed to save prompts to cache", error);
        }
      }
    } finally {
      this.notifyListeners(promptsChanged);
    }
  }

  private notifyListeners(promptsChanged: boolean): void {
    this.listeners.forEach((listener) => listener(promptsChanged));
  }

  /**
   * Reads every `.hjson` file under the given roots, keeping the order of the
   * roots. Missing paths are skipped; anything else that cannot be read is
   * counted so the caller can decide whether the result is trustworthy.
   */
  private async readPromptFiles(
    roots: string[],
  ): Promise<{ files: { filePath: string; data: string }[]; unreadableCount: number }> {
    let unreadableCount = 0;

    const collectPromptFiles = async (targetPath: string): Promise<string[]> => {
      try {
        const stat = await fs.promises.lstat(targetPath);
        if (!stat.isDirectory()) {
          return isPromptFile(targetPath) ? [targetPath] : [];
        }

        const entries = await fs.promises.readdir(targetPath, { withFileTypes: true });
        const nestedFiles = await Promise.all(
          entries.map(async (entry) => {
            if (entry.name.startsWith(".") || entry.name.startsWith("#")) {
              return [];
            }

            const entryPath = path.join(targetPath, entry.name);
            if (entry.isDirectory()) {
              return collectPromptFiles(entryPath);
            }
            return entry.isFile() && isPromptFile(entryPath) ? [entryPath] : [];
          }),
        );
        return nestedFiles.flat();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          unreadableCount += 1;
          console.warn(`Prompt path skipped: ${targetPath}`, error);
        }
        return [];
      }
    };

    const filePaths = (await Promise.all(roots.map(collectPromptFiles))).flat();
    const files: { filePath: string; data: string }[] = [];

    for (let index = 0; index < filePaths.length; index += READ_CONCURRENCY) {
      const batchPaths = filePaths.slice(index, index + READ_CONCURRENCY);
      const batch = await Promise.allSettled(batchPaths.map((filePath) => fs.promises.readFile(filePath, "utf-8")));

      batch.forEach((result, batchIndex) => {
        const filePath = batchPaths[batchIndex];
        if (result.status === "fulfilled") {
          files.push({ filePath, data: result.value });
          return;
        }

        unreadableCount += 1;
        console.warn(`Prompt file read skipped: ${filePath}`, result.reason);
      });
    }

    return { files, unreadableCount };
  }

  /**
   * Prompt sources shown in Prompt Map: the configured directories, active
   * temporary directories, or the bundled library, without the settings
   * prompts that only exist for the Raycast UI.
   */
  public getLibrarySourcePaths(): string[] {
    return this.getPromptFilePaths().filter((promptPath) => !this.isSystemPromptFile(promptPath));
  }

  /** True for the bundled settings prompts, which Prompt Map does not show. */
  public isSystemPromptFile(filePath: string): boolean {
    return filePath === path.join(__dirname, "assets/system_prompts.hjson");
  }

  public getRootPrompts(): PromptProps[] {
    const allSubpromptIds = new Set<string>();
    const collectSubpromptIds = (p: PromptProps) => {
      if (p.subprompts) {
        p.subprompts.forEach((sub) => {
          if (sub.identifier) allSubpromptIds.add(sub.identifier);
          collectSubpromptIds(sub);
        });
      }
    };
    this.prompts.forEach(collectSubpromptIds);

    return this.prompts.filter((p) => !allSubpromptIds.has(p.identifier));
  }

  public getFilteredPrompts(filterFn: (prompt: PromptProps) => boolean): PromptProps[] {
    let results: PromptProps[] = [];
    this.prompts.forEach((prompt) => {
      results = results.concat(this.collectFilteredPrompts(prompt, filterFn));
    });
    return results;
  }

  private collectFilteredPrompts(prompt: PromptProps, filterFn: (prompt: PromptProps) => boolean): PromptProps[] {
    let collected: PromptProps[] = [];
    if (filterFn(prompt)) {
      collected.push(prompt);
    }
    if (prompt.subprompts) {
      prompt.subprompts.forEach((sub) => {
        collected = collected.concat(this.collectFilteredPrompts(sub, filterFn));
      });
    }
    return collected;
  }

  public findPrompt(filterFn: (prompt: PromptProps) => boolean): PromptProps | undefined {
    const findRecursively = (promptsToSearch: PromptProps[]): PromptProps | undefined => {
      for (const prompt of promptsToSearch) {
        if (filterFn(prompt)) {
          return prompt;
        }
        if (prompt.subprompts) {
          const foundInSub = findRecursively(prompt.subprompts);
          if (foundInSub) {
            return foundInSub;
          }
        }
      }
      return undefined;
    };
    return findRecursively(this.prompts);
  }

  public async reloadPrompts(): Promise<void> {
    configurationManager.clearCache();
    await this.loadAllPrompts(true);
  }

  public refreshPrompts(): Promise<void> {
    return this.loadAllPrompts();
  }
}

const promptManager = new PromptManager();

export default promptManager;
