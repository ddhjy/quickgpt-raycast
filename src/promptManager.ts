import * as fs from "fs";
import * as path from "path";
import md5 from "md5";
import { getPreferenceValues } from "@raycast/api";
import * as hjson from 'hjson';

type Preferences = {
  disableDefaultPrompts: boolean;
  customPrompts?: string;
  customPrompts2?: string;
  customPrompts3?: string;
  customPromptsDirectory?: string;
  customPromptsDirectory2?: string;
  customPromptsDirectory3?: string;
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
  rawRef?: { [key: string]: string | string[] };
  options?: { [key: string]: string[] };
  actions?: string[];
};

function loadContentFromFile(filePath: string, baseDir: string): string {
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(baseDir, filePath);
  try {
    return fs.readFileSync(fullPath, 'utf-8');
  } catch (error) {
    console.error(`Error reading file ${fullPath}: ${error}`);
    return `Error: Unable to read file ${filePath}`;
  }
}

class PromptManager {
  private promptsPaths: string[];
  private rootPrompts: PromptProps[];

  constructor() {
    const preferences = getPreferenceValues<Preferences>();
    this.promptsPaths = [
      ...(preferences.disableDefaultPrompts ? [] : [path.join(__dirname, "assets/prompts.json")]),
      ...(preferences.customPrompts ? [preferences.customPrompts] : []),
      ...(preferences.customPrompts2 ? [preferences.customPrompts2] : []),
      ...(preferences.customPrompts3 ? [preferences.customPrompts3] : []),
    ];
    if (preferences.customPromptsDirectory) {
      this.promptsPaths.push(preferences.customPromptsDirectory);
    }
    if (preferences.customPromptsDirectory2) {
      this.promptsPaths.push(preferences.customPromptsDirectory2);
    }
    if (preferences.customPromptsDirectory3) {
      this.promptsPaths.push(preferences.customPromptsDirectory3);
    }
    this.rootPrompts = this.loadAllPrompts();
  }

  private loadPromptsFromFile(filePath: string): PromptProps[] {
    try {
      const data = fs.readFileSync(filePath, "utf-8");
      let prompts: PromptProps[];

      const fileExtension = path.extname(filePath).toLowerCase();

      if (fileExtension === '.hjson') {
        prompts = hjson.parse(data);
      } else if (fileExtension === '.json') {
        prompts = JSON.parse(data);
      } else {
        console.error(`Unsupported file extension: ${fileExtension}`);
        return [];
      }

      const baseDir = path.dirname(filePath);

      const loadContent = (prompt: PromptProps) => {
        if (typeof prompt.content === 'string' && prompt.content.startsWith('/')) {
          prompt.content = loadContentFromFile(prompt.content, baseDir);
        }
        if (prompt.subprompts) {
          prompt.subprompts.forEach(loadContent);
        }
        return prompt;
      };

      return prompts.map(loadContent);
    } catch (error) {
      console.error(`Error loading prompts from ${filePath}:`, error);
      return [];
    }
  }

  private loadAllPrompts(): PromptProps[] {
    let allPrompts: PromptProps[] = [];

    const traverseDirectory = (directoryPath: string) => {
      const files = fs.readdirSync(directoryPath);
      for (const file of files) {
        // 忽略以 # 开头的文件和目录
        if (file.startsWith('#')) {
          continue;
        }

        const filePath = path.join(directoryPath, file);
        const stat = fs.statSync(filePath);
        
        if (stat.isDirectory()) {
          traverseDirectory(filePath);
        } else if (file.endsWith('.pm.json') || file.endsWith('.pm.hjson')) {
          allPrompts = [...allPrompts, ...this.loadPromptsFromFile(filePath)];
        }
      }
    };

    for (const promptPath of this.promptsPaths) {
      if (fs.statSync(promptPath).isDirectory()) {
        traverseDirectory(promptPath);
      } else {
        allPrompts = [...allPrompts, ...this.loadPromptsFromFile(promptPath)];
      }
    }

    return this.processPrompts(allPrompts);
  }

  private processPrompt(prompt: PromptProps): PromptProps {
    if (!prompt.identifier) {
      prompt.identifier = md5(prompt.title);
    }
    if (prompt.ref) {
      prompt.rawRef = { ...prompt.ref };
      prompt.options = {};
      for (const [key, value] of Object.entries(prompt.ref)) {
        if (Array.isArray(value)) {
          prompt.options[key] = value;
        }
      }
      delete prompt.ref;
    }
    if (prompt.subprompts) {
      prompt.subprompts = prompt.subprompts.map(this.processPrompt.bind(this));
    }
    return prompt;
  }

  private processPrompts(prompts: PromptProps[]): PromptProps[] {
    return prompts.map(this.processPrompt.bind(this));
  }

  public getRootPrompts() {
    return this.rootPrompts;
  }

  public getFilteredPrompts(filter: (prompt: PromptProps) => boolean): PromptProps[] {
    const result: PromptProps[] = [];
    const traverse = (prompts: PromptProps[]) => {
      for (const prompt of prompts) {
        if (filter(prompt)) {
          result.push(prompt);
        }
        if (prompt.subprompts) {
          traverse(prompt.subprompts);
        }
      }
    };
    traverse(this.rootPrompts);
    return result;
  }

  public findPrompt(filter: (prompt: PromptProps) => boolean): PromptProps | undefined {
    return this.getFilteredPrompts(filter)[0];
  }
}

const promptManager = new PromptManager();

export default promptManager;