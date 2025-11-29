import * as fs from "fs";
import * as path from "path";
import md5 from "md5";
import * as hjson from "hjson";
import { Cache } from "@raycast/api";
import * as temporaryDirectoryStore from "../stores/temporary-directory-store";
import configurationManager from "./configuration-manager";

export type PromptProps = {
  identifier: string;
  title: string;
  content?: string;
  pattern?: string;
  icon?: string;
  subprompts?: PromptProps[];
  pinned?: boolean;
  prefix?: string;
  suffix?: string;
  noexplanation?: boolean;
  forbidChinese?: boolean;
  ref?: { [key: string]: string | string[] };
  options?: { [key: string]: string[] | Record<string, string> };
  actions?: string[];
  textInputs?: { [key: string]: string };
  path?: string;
  filePath?: string;
  isTemporary?: boolean;
  temporaryDirSource?: string;
};

const NON_INHERITED_PROPS: (keyof PromptProps)[] = [
  "subprompts",
  "identifier",
  "path",
  "pinned",
  "options",
  "textInputs",
];

class PromptManager {
  private promptFilePaths: string[];
  private prompts: PromptProps[] = [];
  private mergedRootProperties: Partial<PromptProps> = {};
  private temporaryDirectoryPaths: string[] = [];
  private cache: Cache = new Cache();
  private readonly CACHE_KEY_DATA = "prompts_data_v1";
  private readonly CACHE_KEY_SIG = "prompts_signature_v1";

  constructor() {
    this.promptFilePaths = this.getPromptFilePaths();
    this.loadAllPrompts();
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

  private loadPromptsFromFileSync(filePath: string): PromptProps[] {
    try {
      const data = fs.readFileSync(filePath, "utf-8");
      let parsed: unknown;
      try {
        parsed = hjson.parse(data);
      } catch (parseError) {
        console.error(`HJSON parsing failed ${filePath}:`, parseError);
        return [];
      }

      let promptsData: Record<string, unknown>[] = [];

      if (Array.isArray(parsed)) {
        promptsData = parsed.filter((item) => typeof item === "object" && item !== null) as Record<string, unknown>[];
      } else if (typeof parsed === "object" && parsed !== null) {
        const parsedObject = parsed as Record<string, unknown>;
        if (parsedObject.rootProperty && typeof parsedObject.rootProperty === "object") {
          const fileRootProperty = parsedObject.rootProperty as Partial<PromptProps>;
          this.mergedRootProperties = { ...this.mergedRootProperties, ...fileRootProperty };

          if (parsedObject.prompts && Array.isArray(parsedObject.prompts)) {
            promptsData = parsedObject.prompts.filter((item) => typeof item === "object" && item !== null) as Record<
              string,
              unknown
            >[];
          } else if (parsedObject.title) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { rootProperty, ...promptObject } = parsedObject;
            if (Object.keys(promptObject).length > 0 && typeof promptObject.title === "string") {
              promptsData = [promptObject];
            }
          }
        } else {
          if (parsedObject.prompts && Array.isArray(parsedObject.prompts)) {
            promptsData = parsedObject.prompts.filter((item) => typeof item === "object" && item !== null) as Record<
              string,
              unknown
            >[];
          } else if (parsedObject.title) {
            promptsData = [parsedObject];
          }
        }
      } else {
        console.warn(`Unsupported HJSON root structure in ${filePath}`);
      }

      const prompts = promptsData.filter((p) => typeof p.title === "string") as PromptProps[];

      const baseDir = path.dirname(filePath);
      const isTemporarySource = this.temporaryDirectoryPaths.some((tempDir) => filePath.startsWith(tempDir));

      let tempDirSource = "";
      if (isTemporarySource) {
        for (const tempDir of this.temporaryDirectoryPaths) {
          if (filePath.startsWith(tempDir)) {
            tempDirSource = tempDir;
            break;
          }
        }
      }

      return prompts.map((prompt: PromptProps) => {
        if (typeof (prompt as PromptProps & { actions?: string | string[] }).actions === "string") {
          prompt.actions = (prompt as PromptProps & { actions: string }).actions
            .split(",")
            .map((action) => action.trim())
            .filter((action) => action.length > 0);
        }

        const processedPrompt = this.loadPromptContentFromFileSync(prompt, baseDir);
        processedPrompt.filePath = filePath;

        if (isTemporarySource) {
          processedPrompt.isTemporary = true;
          processedPrompt.temporaryDirSource = tempDirSource;
        }

        return processedPrompt;
      });
    } catch (error) {
      console.error(`Failed to load prompt file ${filePath}:`, error);
      return [];
    }
  }

  private loadAllPrompts(): void {
    this.prompts = [];
    this.mergedRootProperties = {};

    const currentSignature = this.calculateWorkspaceSignature();

    const cachedSignature = this.cache.get(this.CACHE_KEY_SIG);
    const cachedData = this.cache.get(this.CACHE_KEY_DATA);

    if (currentSignature && cachedSignature === currentSignature && cachedData) {
      try {
        const parsedData = JSON.parse(cachedData);
        this.prompts = parsedData.prompts;
        this.mergedRootProperties = parsedData.mergedRootProperties;
        console.log("Prompts loaded from cache (Fast Mode) ⚡️");
        return;
      } catch (e) {
        console.warn("Cache parse failed, falling back to file load", e);
      }
    }

    console.log("Cache miss or outdated, reloading from disk...");

    this.prompts = this.promptFilePaths.flatMap((promptPath) => {
      try {
        if (!fs.existsSync(promptPath)) return [];
        const stat = fs.lstatSync(promptPath);
        if (stat.isDirectory()) {
          return this.traverseDirectorySync(promptPath);
        } else if (this.isPromptFile(promptPath)) {
          return this.loadPromptsFromFileSync(promptPath);
        }
      } catch (error) {
        if (fs.existsSync(promptPath)) {
          console.error(`Error accessing prompt path: ${promptPath}`, error);
        }
      }
      return [];
    });

    this.prompts = this.processPrompts(this.prompts);

    try {
      const cachePayload = {
        prompts: this.prompts,
        mergedRootProperties: this.mergedRootProperties,
      };
      this.cache.set(this.CACHE_KEY_DATA, JSON.stringify(cachePayload));
      this.cache.set(this.CACHE_KEY_SIG, currentSignature);
    } catch (e) {
      console.error("Failed to save prompts to cache", e);
    }
  }

  private traverseDirectorySync(directoryPath: string): PromptProps[] {
    try {
      return fs
        .readdirSync(directoryPath)
        .filter((file) => !file.startsWith("#") && !file.startsWith("."))
        .flatMap((file) => {
          const filePath = path.join(directoryPath, file);
          try {
            const stat = fs.lstatSync(filePath);
            if (stat.isDirectory()) {
              return this.traverseDirectorySync(filePath);
            } else if (this.isPromptFile(filePath)) {
              return this.loadPromptsFromFileSync(filePath);
            }
          } catch (innerError) {
            console.error(`Error processing ${filePath} within ${directoryPath}:`, innerError);
          }
          return [];
        });
    } catch (error) {
      console.error(`Failed to traverse directory ${directoryPath}:`, error);
      return [];
    }
  }

  private isPromptFile(filePath: string): boolean {
    const fileName = path.basename(filePath).toLowerCase();
    return fileName.endsWith(".hjson");
  }

  private calculateWorkspaceSignature(): string {
    try {
      const signatures: string[] = [];

      signatures.push(JSON.stringify(this.promptFilePaths));

      const processPath = (targetPath: string) => {
        try {
          if (!fs.existsSync(targetPath)) return;
          const stat = fs.statSync(targetPath);

          if (stat.isDirectory()) {
            signatures.push(`${targetPath}:${stat.mtimeMs}`);
            const entries = fs.readdirSync(targetPath);
            signatures.push(entries.join(","));

            entries.forEach((entry) => {
              if (!entry.startsWith(".") && !entry.startsWith("#")) {
                const fullPath = path.join(targetPath, entry);
                processPath(fullPath);
              }
            });
          } else if (this.isPromptFile(targetPath)) {
            signatures.push(`${targetPath}:${stat.mtimeMs}`);
          }
        } catch {
          // ignore
        }
      };

      this.promptFilePaths.forEach((p) => processPath(p));

      return md5(signatures.join("|"));
    } catch (error) {
      console.error("Failed to calculate signature", error);
      return Date.now().toString();
    }
  }

  private loadPromptContentFromFileSync(prompt: PromptProps, baseDir: string): PromptProps {
    if (Array.isArray(prompt.subprompts)) {
      prompt.subprompts = prompt.subprompts.map((subprompt) => this.loadPromptContentFromFileSync(subprompt, baseDir));
    }
    return prompt;
  }

  private processPrompts(prompts: PromptProps[], parentPrompt?: PromptProps): PromptProps[] {
    return prompts.map((prompt) => {
      const baseProperties: Partial<PromptProps> = { ...this.mergedRootProperties };

      if (parentPrompt) {
        for (const key in parentPrompt) {
          if (Object.prototype.hasOwnProperty.call(parentPrompt, key)) {
            const propKey = key as keyof PromptProps;
            if (!NON_INHERITED_PROPS.includes(propKey) && parentPrompt[propKey] !== undefined) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (baseProperties as any)[propKey] = parentPrompt[propKey];
            }
          }
        }
      }

      const originalFilePath = prompt.filePath;

      prompt = { ...baseProperties, ...prompt };

      if (typeof (prompt as PromptProps & { actions?: string | string[] }).actions === "string") {
        prompt.actions = (prompt as PromptProps & { actions: string }).actions
          .split(",")
          .map((action) => action.trim())
          .filter((action) => action.length > 0);
      }

      if (originalFilePath) {
        prompt.filePath = originalFilePath;
      } else if (NON_INHERITED_PROPS.includes("filePath")) {
        if (!prompt.filePath) {
          prompt.filePath = this.mergedRootProperties.filePath;
        }
      }

      prompt = this.processPrompt(prompt);

      if (!prompt.content) {
        prompt.content = prompt.title;
      }

      const currentPath = parentPrompt?.path ? `${parentPrompt.path} / ${prompt.title}` : prompt.title;
      prompt.path = currentPath;

      if (prompt.subprompts) {
        prompt.subprompts = this.processPrompts(prompt.subprompts, prompt);
      }

      return prompt;
    });
  }

  private processPrompt(prompt: PromptProps): PromptProps {
    if (!prompt.identifier) {
      const emojiRegex = /[\p{Emoji}\u{1F3FB}-\u{1F3FF}\u{1F9B0}-\u{1F9B3}]/gu;
      const emojis = prompt.title.match(emojiRegex) || [];
      const emojiStr = emojis.join("");

      const placeholderRegex = /{{([^}]+)}}/g;
      const placeholders = prompt.content?.match(placeholderRegex) || [];
      const placeholderStr = placeholders.map((p) => p.replace(/[{}]/g, "")).join("-");

      const baseStr = [emojiStr, prompt.title.replace(emojiRegex, "").trim(), placeholderStr].filter(Boolean).join("-");

      prompt.identifier = md5(baseStr).substring(0, 8);
    }

    return prompt;
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

  public reloadPrompts(): void {
    console.log("Reloading prompts...");
    configurationManager.clearCache();
    this.cache.remove(this.CACHE_KEY_SIG);
    this.promptFilePaths = this.getPromptFilePaths();
    this.loadAllPrompts();
  }
}

const promptManager = new PromptManager();

export default promptManager;
