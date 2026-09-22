import * as fs from "fs";
import * as path from "path";
import md5 from "md5";
import { environment, type Cache } from "@raycast/api";
import * as temporaryDirectoryStore from "../stores/temporary-directory-store";
import configurationManager from "./configuration-manager";
import { startupElapsedMs, startupLog, startupNowMs, startupWarn } from "../utils/startup-profiler";
import { createNamespacedCache } from "../utils/extension-cache";
import {
  createPromptParseState,
  parsePromptsFromFile,
  processPrompts,
  type PromptParseState,
  type PromptProps,
} from "../utils/prompt-parsing";

export type { PromptProps } from "../utils/prompt-parsing";

export function isPathInsideDirectory(filePath: string, directoryPath: string): boolean {
  const relativePath = path.relative(directoryPath, filePath);
  return (
    relativePath !== "" &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  );
}

interface PromptWorkspaceSnapshot {
  signature: string;
  promptFilePaths: string[];
  directoryCount: number;
  missingPathCount: number;
  unreadablePathCount: number;
  isComplete: boolean;
}

class PromptManager {
  private promptFilePaths: string[];
  private prompts: PromptProps[] = [];
  private parseState: PromptParseState = createPromptParseState();
  private temporaryDirectoryPaths: string[] = [];
  // v3: cached prompts include `sourceIndexPath` and `hasOwnContent` for the
  // Prompt Map editor; bumping the namespace forces a one-time re-parse so
  // stale payloads without those fields are discarded.
  private cache: Cache = createNamespacedCache(`prompts-v3-${environment.commandName}`);
  private readonly CACHE_KEY_DATA = "prompts_data_v3";
  private readonly CACHE_KEY_SIG = "prompts_signature_v3";
  private readonly listeners = new Set<(promptsChanged: boolean) => void>();
  private hasHydratedFromCache = false;
  private isRefreshing = false;
  private activeRefresh?: Promise<void>;
  private lastSignature = "";

  constructor() {
    const started = startupNowMs();
    this.promptFilePaths = this.getPromptFilePaths();
    this.hydrateCachedPrompts();
    startupLog("PromptManager constructor ready", {
      durationMs: startupElapsedMs(started),
      promptPathCount: this.promptFilePaths.length,
      cachedPromptCount: this.prompts.length,
      cacheHydrated: this.hasHydratedFromCache,
    });
  }

  private hydrateCachedPrompts(): boolean {
    const started = startupNowMs();
    const cachedData = this.cache.get(this.CACHE_KEY_DATA);

    if (!cachedData) {
      startupLog("PromptManager cache hydrate skipped", { reason: "missing cache" });
      return false;
    }

    try {
      const parsedData = JSON.parse(cachedData);
      this.prompts = Array.isArray(parsedData.prompts) ? parsedData.prompts : [];
      this.parseState = { mergedRootProperties: parsedData.mergedRootProperties ?? {} };
      this.lastSignature = this.cache.get(this.CACHE_KEY_SIG) ?? "";
      this.hasHydratedFromCache = true;
      startupLog("PromptManager cache hydrated", {
        durationMs: startupElapsedMs(started),
        promptCount: this.prompts.length,
        hasSignature: this.lastSignature.length > 0,
      });
      return true;
    } catch (error) {
      startupWarn("PromptManager cache hydrate failed", {
        durationMs: startupElapsedMs(started),
        error: String(error),
      });
      this.cache.remove(this.CACHE_KEY_DATA);
      this.cache.remove(this.CACHE_KEY_SIG);
      return false;
    }
  }

  private notifyListeners(promptsChanged: boolean): void {
    this.listeners.forEach((listener) => listener(promptsChanged));
  }

  public subscribe(listener: (promptsChanged: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getLoadState(): {
    promptCount: number;
    isRefreshing: boolean;
    hasHydratedFromCache: boolean;
  } {
    return {
      promptCount: this.prompts.length,
      isRefreshing: this.isRefreshing,
      hasHydratedFromCache: this.hasHydratedFromCache,
    };
  }

  public hasPrompts(): boolean {
    return this.prompts.length > 0;
  }

  public getPromptCount(): number {
    return this.prompts.length;
  }

  private getPromptFilePaths(): string[] {
    const customPromptDirectories = configurationManager.getDirectories("prompts");

    const allPaths = [...customPromptDirectories];

    const tempDirs = temporaryDirectoryStore.getActiveTemporaryDirectories();
    this.temporaryDirectoryPaths = tempDirs.map((dir) => dir.path);

    if (this.temporaryDirectoryPaths.length > 0) {
      allPaths.push(...this.temporaryDirectoryPaths);
    }

    if (allPaths.length === 0) {
      const defaultPromptsPath = path.join(__dirname, "assets/prompts.hjson");
      allPaths.push(defaultPromptsPath);
    }

    const systemPromptsPath = path.join(__dirname, "assets/system_prompts.hjson");
    allPaths.push(systemPromptsPath);

    return Array.from(new Set(allPaths));
  }

  private parsePromptsFromFile(data: string, filePath: string): PromptProps[] {
    try {
      const prompts = parsePromptsFromFile(this.parseState, data, filePath);
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

  private loadAllPrompts(reason: string, force = false): Promise<void> {
    if (this.activeRefresh) {
      if (force) {
        startupLog("PromptManager forced refresh queued", { reason });
        return this.activeRefresh.catch(() => undefined).then(() => this.loadAllPrompts(reason, true));
      }
      startupLog("PromptManager refresh joined", { reason });
      return this.activeRefresh;
    }

    const refresh = this.performLoadAllPrompts(reason, force);
    const trackedRefresh = refresh.finally(() => {
      if (this.activeRefresh === trackedRefresh) {
        this.activeRefresh = undefined;
      }
    });
    this.activeRefresh = trackedRefresh;
    return trackedRefresh;
  }

  private async performLoadAllPrompts(reason: string, force: boolean): Promise<void> {
    const started = startupNowMs();
    const previousPrompts = this.prompts;
    const previousParseState = this.parseState;
    const previousSignature = this.lastSignature;
    const hadPreviousSnapshot = this.hasHydratedFromCache || previousPrompts.length > 0;
    let promptsChanged = false;
    this.isRefreshing = true;

    try {
      this.promptFilePaths = this.getPromptFilePaths();
      const snapshot = await this.createWorkspaceSnapshot(reason);
      const currentSignature = snapshot.signature;

      if (!snapshot.isComplete && hadPreviousSnapshot) {
        throw new Error(`Prompt scan skipped ${snapshot.unreadablePathCount} unreadable path(s)`);
      }

      if (!force && currentSignature && this.lastSignature === currentSignature && this.hasHydratedFromCache) {
        startupLog("PromptManager refresh cache hit", {
          reason,
          durationMs: startupElapsedMs(started),
          promptCount: this.prompts.length,
        });
        return;
      }

      const promptFiles: { promptPath: string; data: string }[] = [];
      let failedReadCount = 0;
      const readConcurrency = 16;
      for (let index = 0; index < snapshot.promptFilePaths.length; index += readConcurrency) {
        const batchPaths = snapshot.promptFilePaths.slice(index, index + readConcurrency);
        const batch = await Promise.allSettled(
          batchPaths.map(async (promptPath) => {
            return { promptPath, data: await fs.promises.readFile(promptPath, "utf-8") };
          }),
        );

        batch.forEach((result, batchIndex) => {
          if (result.status === "fulfilled") {
            promptFiles.push(result.value);
            return;
          }

          failedReadCount += 1;
          startupWarn("PromptManager prompt file read skipped", {
            reason,
            promptPath: batchPaths[batchIndex],
            error: String(result.reason),
          });
        });
      }

      const isComplete = snapshot.isComplete && failedReadCount === 0;
      if (!isComplete && hadPreviousSnapshot) {
        throw new Error(`Prompt scan skipped ${snapshot.unreadablePathCount + failedReadCount} unreadable path(s)`);
      }

      this.parseState = createPromptParseState();
      const loadedPrompts = promptFiles.flatMap(({ promptPath, data }) => {
        return this.parsePromptsFromFile(data, promptPath);
      });

      const processStarted = startupNowMs();
      this.prompts = processPrompts(this.parseState, loadedPrompts);
      promptsChanged = true;
      const processMs = startupElapsedMs(processStarted);
      this.lastSignature = isComplete ? currentSignature : "";
      this.hasHydratedFromCache = isComplete;

      if (isComplete) {
        try {
          const cachePayload = {
            prompts: this.prompts,
            mergedRootProperties: this.parseState.mergedRootProperties,
          };
          this.cache.set(this.CACHE_KEY_DATA, JSON.stringify(cachePayload));
          if (currentSignature) {
            this.cache.set(this.CACHE_KEY_SIG, currentSignature);
          }
        } catch (error) {
          console.error("Failed to save prompts to cache", error);
        }
      } else {
        startupWarn("PromptManager using partial cold-start result", {
          reason,
          promptCount: this.prompts.length,
          unreadablePathCount: snapshot.unreadablePathCount + failedReadCount,
        });
      }

      startupLog("PromptManager refresh loaded files", {
        reason,
        durationMs: startupElapsedMs(started),
        processMs,
        promptPathCount: this.promptFilePaths.length,
        promptFileCount: snapshot.promptFilePaths.length,
        promptCount: this.prompts.length,
        forced: force,
        complete: isComplete,
        signatureChanged: currentSignature !== previousSignature,
      });
    } catch (error) {
      this.prompts = previousPrompts;
      this.parseState = previousParseState;
      startupWarn("PromptManager refresh failed", {
        reason,
        durationMs: startupElapsedMs(started),
        error: String(error),
      });
      throw error;
    } finally {
      this.isRefreshing = false;
      this.notifyListeners(promptsChanged);
    }
  }

  private async createWorkspaceSnapshot(reason: string): Promise<PromptWorkspaceSnapshot> {
    const started = startupNowMs();
    const stablePromptPaths = Array.from(new Set(this.promptFilePaths)).sort();
    let directoryCount = 0;
    let missingPathCount = 0;
    let unreadablePathCount = 0;

    const collectPromptFiles = async (targetPath: string): Promise<string[]> => {
      try {
        const stat = await fs.promises.lstat(targetPath);
        if (stat.isDirectory()) {
          directoryCount += 1;
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
              return entry.isFile() && this.isPromptFile(entryPath) ? [entryPath] : [];
            }),
          );
          return nestedFiles.flat();
        }

        return this.isPromptFile(targetPath) ? [targetPath] : [];
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          missingPathCount += 1;
          return [];
        }
        unreadablePathCount += 1;
        startupWarn("PromptManager path skipped", {
          reason,
          targetPath,
          error: String(error),
        });
        return [];
      }
    };

    try {
      const filesByRoot = new Map<string, string[]>();
      await Promise.all(
        stablePromptPaths.map(async (promptPath) => {
          const files = await collectPromptFiles(promptPath);
          filesByRoot.set(promptPath, files);
        }),
      );

      const promptFilePaths = this.promptFilePaths.flatMap((promptPath) => filesByRoot.get(promptPath) ?? []);
      const signatureFiles = stablePromptPaths.flatMap((promptPath) => filesByRoot.get(promptPath) ?? []);
      const fileSignatures = await Promise.all(
        signatureFiles.map(async (filePath) => {
          try {
            const signaturePath = this.getSignaturePath(filePath);
            if (this.isBundledAssetPath(filePath)) {
              return `${signaturePath}:${md5(await fs.promises.readFile(filePath, "utf-8"))}`;
            }
            const stat = await fs.promises.lstat(filePath);
            return `${signaturePath}:${stat.mtimeMs}:${stat.size}`;
          } catch {
            unreadablePathCount += 1;
            return `${this.getSignaturePath(filePath)}:unreadable`;
          }
        }),
      );
      fileSignatures.sort();

      const signatures = [
        JSON.stringify(stablePromptPaths.map((promptPath) => this.getSignaturePath(promptPath))),
        ...fileSignatures,
      ];

      startupLog("PromptManager signature calculated asynchronously", {
        reason,
        durationMs: startupElapsedMs(started),
        promptPathCount: stablePromptPaths.length,
        directoryCount,
        promptFileCount: signatureFiles.length,
        missingPathCount,
        unreadablePathCount,
      });

      return {
        signature: md5(signatures.join("|")),
        promptFilePaths,
        directoryCount,
        missingPathCount,
        unreadablePathCount,
        isComplete: unreadablePathCount === 0,
      };
    } catch (error) {
      startupWarn("PromptManager signature failed", {
        reason,
        durationMs: startupElapsedMs(started),
        error: String(error),
      });
      throw error;
    }
  }

  private isPromptFile(filePath: string): boolean {
    const fileName = path.basename(filePath).toLowerCase();
    return fileName.endsWith(".hjson");
  }

  private getSignaturePath(filePath: string): string {
    const assetsPath = path.join(__dirname, "assets");
    const relativeAssetPath = path.relative(assetsPath, filePath);

    if (relativeAssetPath && !relativeAssetPath.startsWith("..") && !path.isAbsolute(relativeAssetPath)) {
      return `$extension-assets/${relativeAssetPath}`;
    }

    return filePath;
  }

  private isBundledAssetPath(filePath: string): boolean {
    return this.getSignaturePath(filePath).startsWith("$extension-assets/");
  }

  /**
   * Prompt sources shown in Prompt Map: the configured directories, active
   * temporary directories, or the bundled library, without the settings
   * prompts that only exist for the Raycast UI.
   */
  public getLibrarySourcePaths(): string[] {
    const systemPromptsPath = path.join(__dirname, "assets/system_prompts.hjson");
    return this.getPromptFilePaths().filter((promptPath) => promptPath !== systemPromptsPath);
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
    startupLog("PromptManager manual reload requested");
    configurationManager.clearCache();
    await this.loadAllPrompts("manual-reload", true);
  }

  public refreshPrompts(reason = "background-refresh"): Promise<void> {
    return this.loadAllPrompts(reason, false);
  }
}

const promptManager = new PromptManager();

export default promptManager;
