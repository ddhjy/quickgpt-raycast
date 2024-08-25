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
};

class PromptManager {
  private promptsPaths: string[];
  private rootPrompts: PromptProps[];

  constructor() {
    const preferences = getPreferenceValues<Preferences>();
    this.promptsPaths = [
      ...(preferences.disableDefaultPrompts ? [] : [path.join(__dirname, "assets/prompts.json")]),
      ...(preferences.customPrompts ? [preferences.customPrompts] : []),
    ];
    this.rootPrompts = this.loadPrompts();
    this.loadCustomPromptsFromDirectory();
  }

  private loadPrompts() {
    let promptsData: PromptProps[] = [];
    for (const promptPath of this.promptsPaths) {
      const data = fs.readFileSync(promptPath, "utf-8");
      promptsData = [...promptsData, ...JSON.parse(data)];
    }
    const traverse = (prompts: PromptProps[]) => {
      for (const prompt of prompts) {
        if (!prompt.identifier) {
          prompt.identifier = md5(prompt.title);
        }
        if (prompt.subprompts) {
          traverse(prompt.subprompts);
        }
      }
    };
    traverse(promptsData);
    return promptsData;
  }

  loadCustomPromptsFromDirectory() {
    const preferences = getPreferenceValues<Preferences>();
    const customPromptsDirectory = preferences.customPromptsDirectory;

    if (customPromptsDirectory && fs.existsSync(customPromptsDirectory)) {
      const files = fs.readdirSync(customPromptsDirectory);
      for (const file of files) {
        if (path.extname(file) === '.json') {
          const filePath = path.join(customPromptsDirectory, file);
          const content = fs.readFileSync(filePath, 'utf8');
          try {
            const customPrompts = JSON.parse(content);
            this.rootPrompts = [...this.rootPrompts, ...customPrompts];
          } catch (error) {
            console.error(`Error parsing custom prompt file ${file}:`, error);
          }
        }
      }
    }
  }

  public getRootPrompts() {
    return this.rootPrompts;
  }

  public traversePrompts(callback: (prompt: PromptProps) => void) {
    const traverse = (prompts: PromptProps[]) => {
      for (const prompt of prompts) {
        callback(prompt);
        if (prompt.subprompts) {
          traverse(prompt.subprompts);
        }
      }
    };
    traverse(this.rootPrompts);
  }

  public getFilteredPrompts(filter: (prompt: PromptProps) => boolean): PromptProps[] {
    const result: PromptProps[] = [];
    this.traversePrompts((prompt) => {
      if (filter(prompt)) {
        result.push(prompt);
      }
    });
    return result;
  }

  public findPrompt(filter: (prompt: PromptProps) => boolean): PromptProps | undefined {
    let result: PromptProps | undefined;
    this.traversePrompts((prompt) => {
      if (filter(prompt)) {
        result = prompt;
      }
    });
    return result;
  }
}

const promptManager = new PromptManager();

export default promptManager;