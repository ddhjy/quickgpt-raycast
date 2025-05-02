import * as fs from "fs";
import * as path from "path";
import md5 from "md5";
import { getPreferenceValues } from "@raycast/api";
import * as hjson from "hjson";
import * as temporaryDirectoryStore from "../stores/TemporaryPromptDirectoryStore";

type Preferences = {
  customPrompts?: string;
  customPrompts2?: string;
  customPrompts3?: string;
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
  prefixCMD?: string;
  noexplanation?: boolean;
  forbidChinese?: boolean;
  ref?: { [key: string]: string | string[] };
  options?: { [key: string]: string[] };
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
    const customPromptFiles = [
      preferences.customPrompts,
      preferences.customPrompts2,
      preferences.customPrompts3,
    ].filter(Boolean) as string[];

    // Path to the new system prompts file
    const systemPromptsPath = path.join(__dirname, "assets/system_prompts.hjson");

    // Always include system prompts. Include default prompts only if no custom directories are specified.
    const defaultPromptsPath = path.join(__dirname, "assets/prompts.hjson");
    const promptFiles = customPromptDirectories.length > 0 ? [] : [defaultPromptsPath];

    // Get list of temporary directories
    const tempDirs = temporaryDirectoryStore.getActiveTemporaryDirectories();
    this.temporaryDirectoryPaths = tempDirs.map((dir) => dir.path);

    const allPaths = [...promptFiles, ...customPromptFiles, ...customPromptDirectories];

    // Add all temporary directories to the path list
    if (this.temporaryDirectoryPaths.length > 0) {
      allPaths.push(...this.temporaryDirectoryPaths);
    }

    // Finally add the system prompts path
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
        // Use HJSON parser
        parsed = hjson.parse(data);
      } catch (parseError) {
        console.error(`HJSON parsing failed ${filePath}:`, parseError);
        return [];
      }

      let promptsData: Record<string, unknown>[] = [];

      if (Array.isArray(parsed)) {
        // Rule: If the top level is an array, it only contains prompts, no rootProperty
        promptsData = parsed.filter((item) => typeof item === "object" && item !== null) as Record<string, unknown>[];
      } else if (typeof parsed === "object" && parsed !== null) {
        // Rule: If the top level is an object, it might contain rootProperty
        const parsedObject = parsed as Record<string, unknown>;
        if (parsedObject.rootProperty && typeof parsedObject.rootProperty === "object") {
          const fileRootProperty = parsedObject.rootProperty as Partial<PromptProps>;
          // Merge global default values (later values overwrite earlier ones)
          this.mergedRootProperties = { ...this.mergedRootProperties, ...fileRootProperty };
          // console.log(`Merged rootProperty from ${filePath}`, fileRootProperty); // Optional debug log

          // Determine the location of prompt data
          if (parsedObject.prompts && Array.isArray(parsedObject.prompts)) {
            // Case 1: Prompts are under the 'prompts' key
            promptsData = parsedObject.prompts.filter((item) => typeof item === "object" && item !== null) as Record<
              string,
              unknown
            >[];
          } else if (parsedObject.title) {
            // Case 2: The object itself (after removing rootProperty) is a prompt
            // Create a new object excluding rootProperty
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { rootProperty, ...promptObject } = parsedObject;
            // Ensure the remaining object is a valid prompt object (check title specifically)
            if (Object.keys(promptObject).length > 0 && typeof promptObject.title === "string") {
              promptsData = [promptObject];
            }
            // If the object only contained rootProperty, promptsData remains empty
          }
          // else: Object contains rootProperty but no recognizable prompts; this file only contributes default values
        } else {
          // Top level is an object, but no rootProperty key.
          // Assume this object itself is a prompt, or contains a 'prompts' array.
          if (parsedObject.prompts && Array.isArray(parsedObject.prompts)) {
            promptsData = parsedObject.prompts.filter((item) => typeof item === "object" && item !== null) as Record<
              string,
              unknown
            >[];
          } else if (parsedObject.title) {
            // Assume the object itself is a prompt
            promptsData = [parsedObject];
          }
          // else: Unrecognized top-level object structure, ignore
        }
      } else {
        // Top-level structure is neither object nor array, ignore
        console.warn(`Unsupported HJSON root structure in ${filePath}`);
      }

      // --- Post-processing of extracted promptsData ---
      // Basic validation: ensure it's an object and has a title (filter already did basic object check)
      const prompts = promptsData.filter((p) => typeof p.title === "string") as PromptProps[];

      const baseDir = path.dirname(filePath);
      // Check if it comes from any temporary directory
      const isTemporarySource = this.temporaryDirectoryPaths.some((tempDir) => filePath.startsWith(tempDir));

      // If it's from a temporary directory, record which one it belongs to for updating usage time
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
      // Handle file reading errors etc.
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
    this.prompts = []; // Clear existing prompts
    this.mergedRootProperties = {}; // Reset merged root properties before loading

    this.prompts = this.promptFilePaths.flatMap((promptPath) => {
      try {
        const stat = fs.lstatSync(promptPath);
        if (stat.isDirectory()) {
          return this.traverseDirectorySync(promptPath);
        } else if (this.isPromptFile(promptPath)) {
          return this.loadPromptsFromFileSync(promptPath);
        }
      } catch (error) {
        // Log if path doesn't exist or is inaccessible, but continue loading others
        // Avoid console.error for common cases like a non-existent optional path
        if (fs.existsSync(promptPath)) {
          console.error(`Error accessing prompt path: ${promptPath}`, error);
        } else {
          // console.log(`Optional prompt path not found: ${promptPath}`); // Optional: log missing optional paths less verbosely
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
        .filter((file) => !file.startsWith("#") && !file.startsWith(".")) // Also ignore hidden files
        .flatMap((file) => {
          const filePath = path.join(directoryPath, file);
          try {
            // Add inner try-catch for individual file/dir issues
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
   * like actions, prefixCMD, icon, and filePath from parent prompts.
   *
   * @param prompts The array of prompts to process.
   * @param parentPrompt Optional parent prompt for context (inheritance, path calculation).
   * @returns The array of processed prompts.
   */
  private processPrompts(prompts: PromptProps[], parentPrompt?: PromptProps): PromptProps[] {
    return prompts.map((prompt) => {
      // Start with root properties as the absolute base
      const baseProperties: Partial<PromptProps> = { ...this.mergedRootProperties };

      // Inherit from parent by default, excluding specific properties
      if (parentPrompt) {
        // Iterate over all keys of the parent prompt
        for (const key in parentPrompt) {
          // Ensure the key is a valid PromptProps key and owned by the parent object
          if (Object.prototype.hasOwnProperty.call(parentPrompt, key)) {
            const propKey = key as keyof PromptProps;
            // Check if the property is NOT in the exclusion list AND the parent has a defined value
            if (!NON_INHERITED_PROPS.includes(propKey) && parentPrompt[propKey] !== undefined) {
              // Copy the parent's property value to baseProperties
              // Parent properties will overwrite root properties if they exist
              // Add type assertion to satisfy TypeScript, suppress linter warning for 'any'
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              baseProperties[propKey] = parentPrompt[propKey] as any;
            }
          }
        }
      }

      // Preserve the original filePath from the prompt object before merging,
      // as filePath is in NON_INHERITED_PROPS and should always reflect the definition source.
      const originalFilePath = prompt.filePath;

      // Combine base properties (Root + Inherited Parent) with the prompt itself.
      // Prompt's own properties take the highest priority, overwriting inherited ones.
      prompt = { ...baseProperties, ...prompt };

      // Ensure the correct filePath is retained (the one set during loading)
      // If the prompt had its own filePath, the merge already prioritized it.
      // If it didn't, we make sure it's not incorrectly set to undefined if baseProperties didn't have one.
      // Since filePath is in NON_INHERITED_PROPS, it won't be in baseProperties from the parent.
      // We rely on the filePath being correctly set during the initial load (`loadPromptsFromFileSync`).
      // If originalFilePath exists, ensure it's kept. If not, it remains undefined or as set by rootProperty initially.
      if (originalFilePath) {
        prompt.filePath = originalFilePath;
      } else if (NON_INHERITED_PROPS.includes("filePath")) {
        // If it's non-inherited and wasn't set originally, ensure it's not present unless from rootProperty
        // Note: The check `!prompt.filePath` might be redundant due to the `originalFilePath` check above,
        // but it ensures clarity that we only assign root if filePath isn't already set.
        if (!prompt.filePath) {
          prompt.filePath = this.mergedRootProperties.filePath;
        }
      }
      // Note: Simplified filePath handling relies on the initial load setting it correctly
      // and the NON_INHERITED_PROPS preventing parent override.

      // Process the prompt (e.g., ensure ID exists)
      prompt = this.processPrompt(prompt); // Ensure ID is generated if needed

      // Recalculate path based on hierarchy (always overrides any potential inherited 'path')
      const currentPath = parentPrompt?.path ? `${parentPrompt.path} / ${prompt.title}` : prompt.title;
      prompt.path = currentPath;

      // Recursively process subprompts
      if (prompt.subprompts) {
        prompt.subprompts = this.processPrompts(
          prompt.subprompts,
          prompt, // Pass the *current*, processed prompt as the parent
        );
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

    // Return only top-level prompts (those not appearing as a subprompt)
    // This simplistic check assumes identifiers are unique and reliable.
    // A path-based approach might be more robust if identifiers aren't guaranteed unique across files.
    return this.prompts.filter((p) => !allSubpromptIds.has(p.identifier));

    // Alternative: Return all prompts regardless of nesting if needed
    // return this.prompts;
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
