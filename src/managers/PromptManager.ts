import * as fs from "fs";
import * as path from "path";
import md5 from "md5";
import { getPreferenceValues } from "@raycast/api";
import * as hjson from 'hjson';

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
};

function loadContentFromFileSync(filePath: string, baseDir: string): string {
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(baseDir, filePath);
  try {
    return fs.readFileSync(fullPath, 'utf-8');
  } catch (error) {
    console.error(`读取文件失败 ${fullPath}:`, error);
    return `Error: Unable to read file ${filePath}`;
  }
}

/**
 * Manages loading, parsing, processing, and accessing prompt templates.
 * Reads prompts from HJSON files located in configured directories or default paths.
 * Handles nested prompts (subprompts) and content loading from external files.
 * Generates unique identifiers for prompts if not provided.
 */
class PromptManager {
  private promptFilePaths: string[];
  private prompts: PromptProps[] = [];

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
      preferences.customPromptsDirectory4
    ].filter(Boolean) as string[];
    const customPromptFiles = [preferences.customPrompts, preferences.customPrompts2, preferences.customPrompts3].filter(Boolean) as string[];

    // Path to the new system prompts file
    const systemPromptsPath = path.join(__dirname, "assets/system_prompts.hjson");

    // Always include system prompts. Include default prompts only if no custom directories are specified.
    const defaultPromptsPath = path.join(__dirname, "assets/prompts.hjson");
    const promptFiles = customPromptDirectories.length > 0 ? [] : [defaultPromptsPath];

    // Load default/user files/directories first, then append system prompts
    return [
      ...promptFiles,
      ...customPromptFiles,
      ...customPromptDirectories,
      systemPromptsPath // Append system prompts path at the end
    ];
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
      const parsed = hjson.parse(data);
      const prompts = Array.isArray(parsed) ? parsed : [parsed];
      const baseDir = path.dirname(filePath);
      return prompts.map((prompt: PromptProps) => {
        const processedPrompt = this.loadPromptContentFromFileSync(prompt, baseDir);
        processedPrompt.filePath = filePath;
        return processedPrompt;
      });
    } catch (error) {
      console.error(`加载提示失败 ${filePath}:`, error);
      return [];
    }
  }

  /**
   * Loads prompts from all configured file paths.
   * Distinguishes between files and directories, traversing directories recursively.
   * Processes the combined list of prompts after loading.
   */
  private loadAllPrompts(): void {
    this.prompts = this.promptFilePaths.flatMap(promptPath => {
      try {
        const stat = fs.lstatSync(promptPath);
        if (stat.isDirectory()) {
          return this.traverseDirectorySync(promptPath);
        } else if (this.isPromptFile(promptPath)) {
          return this.loadPromptsFromFileSync(promptPath);
        }
      } catch (error) {
        console.warn(`提示路径不存在或无法访问: ${promptPath}`, error);
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
      return fs.readdirSync(directoryPath)
        .filter(file => !file.startsWith('#'))
        .flatMap(file => {
          const filePath = path.join(directoryPath, file);
          const stat = fs.lstatSync(filePath);
          if (stat.isDirectory()) {
            return this.traverseDirectorySync(filePath);
          } else if (this.isPromptFile(filePath)) {
            return this.loadPromptsFromFileSync(filePath);
          }
          return [];
        });
    } catch (error) {
      console.error(`遍历目录失败 ${directoryPath}:`, error);
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
    return fileName.endsWith('.hjson');
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
      prompt.subprompts = prompt.subprompts.map(subprompt => this.loadPromptContentFromFileSync(subprompt, baseDir));
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
    return prompts.map(prompt => {
      prompt = this.processPrompt(prompt);

      const currentPath = parentPrompt?.path ? `${parentPrompt.path} / ${prompt.title}` : prompt.title;
      prompt.path = currentPath;

      if (!prompt.actions && parentPrompt?.actions) {
        prompt.actions = parentPrompt.actions;
      }

      if (!prompt.prefixCMD && parentPrompt?.prefixCMD) {
        prompt.prefixCMD = parentPrompt.prefixCMD;
      }

      if (!prompt.icon && parentPrompt?.icon) {
        prompt.icon = parentPrompt.icon;
      }

      if (!prompt.filePath && parentPrompt?.filePath) {
        prompt.filePath = parentPrompt.filePath;
      }

      if (prompt.subprompts) {
        prompt.subprompts = this.processPrompts(
          prompt.subprompts,
          prompt
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
      const emojiStr = emojis.join('');

      const placeholderRegex = /{{([^}]+)}}/g;
      const placeholders = prompt.content?.match(placeholderRegex) || [];
      const placeholderStr = placeholders
        .map(p => p.replace(/[{}]/g, ''))
        .join('-');

      const baseStr = [
        emojiStr,
        prompt.title.replace(emojiRegex, '').trim(),
        placeholderStr
      ].filter(Boolean).join('-');

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
    return this.prompts;
  }

  /**
   * Returns a flattened list of all prompts (including subprompts) that satisfy the filter function.
   *
   * @param filterFn A function that takes a PromptProps object and returns true if it should be included.
   * @returns A flattened array of PromptProps matching the filter.
   */
  public getFilteredPrompts(filterFn: (prompt: PromptProps) => boolean): PromptProps[] {
    return this.prompts.flatMap(prompt => this.collectFilteredPrompts(prompt, filterFn));
  }

  /**
   * Recursively collects prompts (and subprompts) that satisfy the filter function.
   *
   * @param prompt The current prompt object to check.
   * @param filterFn The filter function.
   * @returns An array of PromptProps matching the filter within this branch of the hierarchy.
   */
  private collectFilteredPrompts(prompt: PromptProps, filterFn: (prompt: PromptProps) => boolean): PromptProps[] {
    const result: PromptProps[] = [];
    if (filterFn(prompt)) {
      result.push(prompt);
    }
    if (Array.isArray(prompt.subprompts)) {
      result.push(...prompt.subprompts.flatMap(subprompt => this.collectFilteredPrompts(subprompt, filterFn)));
    }
    return result;
  }

  /**
   * Finds the first prompt (including subprompts) that satisfies the filter function using depth-first search.
   *
   * @param filterFn A function that takes a PromptProps object and returns true if it matches.
   * @returns The first matching PromptProps object, or undefined if no match is found.
   */
  public findPrompt(filterFn: (prompt: PromptProps) => boolean): PromptProps | undefined {
    const stack: PromptProps[] = [...this.prompts];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;
      if (filterFn(current)) {
        return current;
      }
      if (Array.isArray(current.subprompts)) {
        stack.push(...current.subprompts);
      }
    }
    return undefined;
  }

  /**
   * Reloads all prompts from the configured file paths.
   * This clears the current prompts and re-runs the loading and processing steps.
   */
  public reloadPrompts(): void {
    this.loadAllPrompts();
  }
}

const promptManager = new PromptManager();

export default promptManager;