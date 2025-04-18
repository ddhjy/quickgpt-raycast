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

class PromptManager {
  private promptFilePaths: string[];
  private prompts: PromptProps[] = [];

  constructor() {
    const preferences = getPreferenceValues<Preferences>();
    this.promptFilePaths = this.getPromptFilePaths(preferences);
    this.loadAllPrompts();
  }

  private getPromptFilePaths(preferences: Preferences): string[] {
    const customPromptDirectories = [
      preferences.customPromptsDirectory,
      preferences.customPromptsDirectory1,
      preferences.customPromptsDirectory2,
      preferences.customPromptsDirectory3,
      preferences.customPromptsDirectory4
    ].filter(Boolean) as string[];
    const customPromptFiles = [preferences.customPrompts, preferences.customPrompts2, preferences.customPrompts3].filter(Boolean) as string[];

    // If there are custom prompt directories, don't load default prompts
    const promptFiles = customPromptDirectories.length > 0 ? [] : [path.join(__dirname, "assets/prompts.hjson")];

    return [...promptFiles, ...customPromptFiles, ...customPromptDirectories];
  }

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

  private isPromptFile(filePath: string): boolean {
    const fileName = path.basename(filePath).toLowerCase();
    return fileName.endsWith('.hjson');
  }

  private loadPromptContentFromFileSync(prompt: PromptProps, baseDir: string): PromptProps {
    if (Array.isArray(prompt.subprompts)) {
      prompt.subprompts = prompt.subprompts.map(subprompt => this.loadPromptContentFromFileSync(subprompt, baseDir));
    }
    return prompt;
  }

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

    if (prompt.ref) {
      prompt.options = {};
      prompt.textInputs = {};

      Object.entries(prompt.ref).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          prompt.options = prompt.options || {};
          prompt.options[key] = value;
        } else if (typeof value === 'string') {
          prompt.textInputs = prompt.textInputs || {};
          prompt.textInputs[key] = value;
        }
      });

      delete prompt.ref;
    }

    return prompt;
  }

  public getRootPrompts(): PromptProps[] {
    return this.prompts;
  }

  public getFilteredPrompts(filterFn: (prompt: PromptProps) => boolean): PromptProps[] {
    return this.prompts.flatMap(prompt => this.collectFilteredPrompts(prompt, filterFn));
  }

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

  public reloadPrompts(): void {
    this.loadAllPrompts();
  }
}

const promptManager = new PromptManager();

export default promptManager;