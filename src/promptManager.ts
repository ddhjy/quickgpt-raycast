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
      return JSON.parse(data);
    } catch (error) {
      console.error(`Error loading prompts from ${filePath}:`, error);
      return [];
    }
  }

  private processPrompts(prompts: PromptProps[]): PromptProps[] {
    const traverse = (items: PromptProps[]) => {
      for (let item of items) {
        if (!item.identifier) {
          item.identifier = md5(item.title);
        }
        item = this.handleFileReference(item);
        if (item.subprompts) {
          item.subprompts = item.subprompts.map(this.handleFileReference);
          traverse(item.subprompts);
        }
      }
    };
    traverse(prompts);
    return prompts;
  }

  private handleFileReference(prompt: PromptProps): PromptProps {
    if (prompt.ref) {
      console.log(prompt.ref);
      for (const [key, filePath] of Object.entries(prompt.ref)) {
        try {
          const fileContent = fs.readFileSync(filePath, 'utf8');
          console.log( "zkdebug fileContent:  ", fileContent);
          const placeholder = `{{${key}}}`;
          prompt.content = prompt.content?.replace(placeholder, fileContent);
        } catch (error) {
          console.error(`Error reading file: ${filePath}`, error);
        }
      }
    }
    return prompt;
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