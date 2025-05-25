import * as fs from "fs";
import * as path from "path";
import md5 from "md5";
import { getPreferenceValues } from "@raycast/api";
import * as hjson from "hjson";
import * as temporaryDirectoryStore from "../stores/temporary-directory-store";

type Preferences = {
  customPromptsDirectory?: string;
  customPromptsDirectory1?: string;
  customPromptsDirectory2?: string;
  customPromptsDirectory3?: string;
  customPromptsDirectory4?: string;
};

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

// List of properties that should NOT be inherited from parent to child
const NON_INHERITED_PROPS: (keyof PromptProps)[] = [
  "subprompts",
  "identifier",
  "path",
  "pinned",
  "options",
  "textInputs",
];

/**
 * Manages loading, parsing, processing, and accessing prompt templates.
 * Reads prompts from HJSON files located in configured directories or default paths.
 * Handles nested prompts (subprompts) and content loading from external files.
 * Generates unique identifiers for prompts if not provided.
 */
class PromptManager {
  private promptFilePaths: string[];
  private prompts: PromptProps[] = [];
  private mergedRootProperties: Partial<PromptProps> = {}; // Stores merged root properties
  private temporaryDirectoryPaths: string[] = []; // Modified to store multiple temporary directory paths

  /**
   * Initializes the PromptManager by determining prompt file paths based on preferences
   * and loading all prompts from those paths.
   */
  constructor() {
    const preferences = getPreferenceValues<Preferences>();
    this.promptFilePaths = this.getPromptFilePaths(preferences);
    this.loadAllPrompts();
  }

  /**
   * Determines the list of file and directory paths to load prompts from.
   * Combines default paths, user-configured files, and user-configured directories
   * specified in the extension preferences. Always includes the system prompts file.
   *
   * @param preferences The extension preferences object.
   * @returns An array of absolute file and directory paths.
   */
  private getPromptFilePaths(preferences: Preferences): string[] {
    const customPromptDirectories = [
      preferences.customPromptsDirectory,
      preferences.customPromptsDirectory1,
      preferences.customPromptsDirectory2,
      preferences.customPromptsDirectory3,
      preferences.customPromptsDirectory4,
    ].filter(Boolean) as string[];

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

  /**
   * Loads and parses prompts from a single HJSON file synchronously.
   * Handles potential file reading or parsing errors.
   * Processes each loaded prompt to load content from external files if specified.
   *
   * @param filePath The absolute path to the HJSON prompt file.
   * @returns An array of PromptProps loaded from the file, or an empty array if an error occurs.
   */
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
          // Merge global default values (later values overwrite earlier ones)
          this.mergedRootProperties = { ...this.mergedRootProperties, ...fileRootProperty };
          // console.log(`Merged rootProperty from ${filePath}`, fileRootProperty); // Optional debug log

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
        // loadPromptContentFromFileSync remains largely unchanged unless content needs file loading
        const processedPrompt = this.loadPromptContentFromFileSync(prompt, baseDir);
        processedPrompt.filePath = filePath; // Assign the file path

        // Add temporary directory flag and source directory
        if (isTemporarySource) {
          processedPrompt.isTemporary = true;
          processedPrompt.temporaryDirSource = tempDirSource; // Add temporary directory source to prompt properties
        }

        return processedPrompt;
      });
    } catch (error) {
      console.error(`Failed to load prompt file ${filePath}:`, error);
      return [];
    }
  }

  /**
   * Loads prompts from all configured file paths.
   * Distinguishes between files and directories, traversing directories recursively.
   * Processes the combined list of prompts after loading.
   */
  private loadAllPrompts(): void {
    this.prompts = [];
    this.mergedRootProperties = {};

    this.prompts = this.promptFilePaths.flatMap((promptPath) => {
      try {
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
  }

  /**
   * Recursively traverses a directory to find and load prompts from HJSON files.
   * Ignores files starting with '#'.
   *
   * @param directoryPath The absolute path to the directory to traverse.
   * @returns An array of PromptProps found within the directory and its subdirectories.
   */
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

  /**
   * Checks if a given file path corresponds to a prompt file (HJSON).
   *
   * @param filePath The path to check.
   * @returns True if the file has a .hjson extension, false otherwise.
   */
  private isPromptFile(filePath: string): boolean {
    const fileName = path.basename(filePath).toLowerCase();
    return fileName.endsWith(".hjson");
  }

  /**
   * Recursively processes a prompt and its subprompts to load content specified
   * via file paths in the `content` property (if applicable, though current structure might not use this).
   * This method seems primarily focused on processing subprompts recursively.
   *
   * @param prompt The prompt object to process.
   * @param baseDir The base directory for resolving relative file paths (usually the directory of the HJSON file).
   * @returns The processed prompt object.
   */
  private loadPromptContentFromFileSync(prompt: PromptProps, baseDir: string): PromptProps {
    if (Array.isArray(prompt.subprompts)) {
      prompt.subprompts = prompt.subprompts.map((subprompt) => this.loadPromptContentFromFileSync(subprompt, baseDir));
    }
    return prompt;
  }

  /**
   * Processes a list of prompts recursively.
   * Assigns generated identifiers, calculates hierarchical paths, and inherits properties
   * like actions, prefix, icon, and filePath from parent prompts.
   *
   * @param prompts The array of prompts to process.
   * @param parentPrompt Optional parent prompt for context (inheritance, path calculation).
   * @returns The array of processed prompts.
   */
  private processPrompts(prompts: PromptProps[], parentPrompt?: PromptProps): PromptProps[] {
    return prompts.map((prompt) => {
      const baseProperties: Partial<PromptProps> = { ...this.mergedRootProperties };

      if (parentPrompt) {
        for (const key in parentPrompt) {
          if (Object.prototype.hasOwnProperty.call(parentPrompt, key)) {
            const propKey = key as keyof PromptProps;
            if (!NON_INHERITED_PROPS.includes(propKey) && parentPrompt[propKey] !== undefined) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              baseProperties[propKey] = parentPrompt[propKey] as any;
            }
          }
        }
      }

      const originalFilePath = prompt.filePath;

      prompt = { ...baseProperties, ...prompt };

      if (originalFilePath) {
        prompt.filePath = originalFilePath;
      } else if (NON_INHERITED_PROPS.includes("filePath")) {
        if (!prompt.filePath) {
          prompt.filePath = this.mergedRootProperties.filePath;
        }
      }

      prompt = this.processPrompt(prompt);

      const currentPath = parentPrompt?.path ? `${parentPrompt.path} / ${prompt.title}` : prompt.title;
      prompt.path = currentPath;

      if (prompt.subprompts) {
        prompt.subprompts = this.processPrompts(prompt.subprompts, prompt);
      }

      return prompt;
    });
  }

  /**
   * Processes a single prompt to ensure it has a unique identifier.
   * If no identifier is provided, generates one based on a hash of its title,
   * emojis, and placeholder names.
   *
   * @param prompt The prompt object to process.
   * @returns The processed prompt object with an identifier.
   */
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

  /**
   * Returns the array of all loaded and processed root-level prompts.
   *
   * @returns An array of PromptProps representing the root prompts.
   */
  public getRootPrompts(): PromptProps[] {
    // Filter out any prompts that might be nested as subprompts elsewhere
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

  /**
   * Returns a flattened list of all prompts (including subprompts) that satisfy the filter function.
   *
   * @param filterFn A function that takes a PromptProps object and returns true if it should be included.
   * @returns A flattened array of PromptProps matching the filter.
   */
  public getFilteredPrompts(filterFn: (prompt: PromptProps) => boolean): PromptProps[] {
    let results: PromptProps[] = [];
    this.prompts.forEach((prompt) => {
      results = results.concat(this.collectFilteredPrompts(prompt, filterFn));
    });
    return results;
  }

  /**
   * Recursively collects prompts (and subprompts) that satisfy the filter function.
   *
   * @param prompt The current prompt object to check.
   * @param filterFn The filter function.
   * @returns An array of PromptProps matching the filter within this branch of the hierarchy.
   */
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

  /**
   * Finds the first prompt (including subprompts) that satisfies the filter function using depth-first search.
   *
   * @param filterFn A function that takes a PromptProps object and returns true if it matches.
   * @returns The first matching PromptProps object, or undefined if no match is found.
   */
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

  /**
   * Reloads all prompts from the configured file paths.
   * This clears the current prompts and re-runs the loading and processing steps.
   */
  public reloadPrompts(): void {
    console.log("Reloading prompts...");
    const preferences = getPreferenceValues<Preferences>();
    this.promptFilePaths = this.getPromptFilePaths(preferences);
    this.loadAllPrompts();
  }
}

const promptManager = new PromptManager();

export default promptManager;
