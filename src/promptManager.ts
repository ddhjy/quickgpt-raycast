import * as fs from "fs";
import * as path from "path";
import md5 from "md5";
import { getPreferenceValues } from "@raycast/api";

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
  ref?: { [key: string]: string };
  rawRef?: { [key: string]: string };
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
    ];
    if (preferences.customPromptsDirectory) {
      this.promptsPaths.push(preferences.customPromptsDirectory);
    }
    this.rootPrompts = this.loadAllPrompts();
  }

  private loadAllPrompts(): PromptProps[] {
    let allPrompts: PromptProps[] = [];
    
    for (const promptPath of this.promptsPaths) {
      if (fs.statSync(promptPath).isDirectory()) {
        const files = fs.readdirSync(promptPath);
        for (const file of files) {
          if (path.extname(file) === '.json') {
            const filePath = path.join(promptPath, file);
            allPrompts = [...allPrompts, ...this.loadPromptsFromFile(filePath)];
          }
        }
      } else {
        allPrompts = [...allPrompts, ...this.loadPromptsFromFile(promptPath)];
      }
    }

    return this.processPrompts(allPrompts);
  }

  private loadPromptsFromFile(filePath: string): PromptProps[] {
    try {
      const data = fs.readFileSync(filePath, "utf-8");
      const prompts = JSON.parse(data);
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

  private processPrompts(prompts: PromptProps[]): PromptProps[] {
    const process = (prompt: PromptProps): PromptProps => {
      if (!prompt.identifier) {
        prompt.identifier = md5(prompt.title);
      }
      if (prompt.ref) {
        prompt.rawRef = { ...prompt.ref };
        delete prompt.ref;
      }
      if (prompt.subprompts) {
        prompt.subprompts = prompt.subprompts.map(process);
      }
      return prompt;
    };
    return prompts.map(process);
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