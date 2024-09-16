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
  textInputs?: { [key: string]: string };
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
  private promptFilePaths: string[];
  private prompts: PromptProps[];

  constructor() {
    const preferences = getPreferenceValues<Preferences>();
    this.promptFilePaths = this.buildPromptFilePaths(preferences);
    this.prompts = this.loadAllPrompts();
  }

  /**
   * 构建所有提示文件和目录的路径数组
   * @param preferences 用户偏好设置
   * @returns prompt 文件和目录的路径数组
   */
  private buildPromptFilePaths(preferences: Preferences): string[] {
    const promptFiles: string[] = [];

    if (!preferences.disableDefaultPrompts) {
      promptFiles.push(path.join(__dirname, "assets/prompts.pm.json"));
    }

    const customPromptFiles = [
      preferences.customPrompts,
      preferences.customPrompts2,
      preferences.customPrompts3
    ].filter(Boolean) as string[];

    const customPromptDirectories = [
      preferences.customPromptsDirectory,
      preferences.customPromptsDirectory2,
      preferences.customPromptsDirectory3
    ].filter(Boolean) as string[];

    return [...promptFiles, ...customPromptFiles, ...customPromptDirectories];
  }

  /**
   * 从指定文件加载提示
   * @param filePath 提示文件的路径
   * @returns PromptProps 数组
   */
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

      return prompts.map(prompt => this.resolvePromptContent(prompt, baseDir));
    } catch (error) {
      console.error(`Error loading prompts from ${filePath}:`, error);
      return [];
    }
  }

  /**
   * 递归加载所有提示
   * @returns 所有加载的 PromptProps 数组
   */
  private loadAllPrompts(): PromptProps[] {
    const allPrompts: PromptProps[] = [];

    for (const promptPath of this.promptFilePaths) {
      if (!fs.existsSync(promptPath)) {
        console.warn(`Prompt path does not exist: ${promptPath}`);
        continue;
      }

      const stat = fs.statSync(promptPath);

      if (stat.isDirectory()) {
        this.traverseDirectory(promptPath, allPrompts);
      } else if (this.isPromptFile(promptPath)) {
        this.pushPrompts(allPrompts, this.loadPromptsFromFile(promptPath));
      }
    }

    return this.processPrompts(allPrompts);
  }

  /**
   * 遍历目录并加载其中的提示文件
   * @param directoryPath 目录路径
   * @param accumulator 累积PromptProps的数组
   */
  private traverseDirectory(directoryPath: string, accumulator: PromptProps[]): void {
    let files: string[];
    try {
      files = fs.readdirSync(directoryPath);
    } catch (error) {
      console.error(`Error reading directory ${directoryPath}:`, error);
      return;
    }

    for (const file of files) {
      // 忽略以 # 开头的文件和目录
      if (file.startsWith('#')) {
        continue;
      }

      const filePath = path.join(directoryPath, file);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(filePath);
      } catch (error) {
        console.error(`Error getting stats for ${filePath}:`, error);
        continue;
      }

      if (stat.isDirectory()) {
        this.traverseDirectory(filePath, accumulator);
      } else if (this.isPromptFile(filePath)) {
        this.pushPrompts(accumulator, this.loadPromptsFromFile(filePath));
      }
    }
  }

  /**
   * 判断文件是否为支持的提示文件类型
   * @param filePath 文件路径
   * @returns 是否为支持的提示文件
   */
  private isPromptFile(filePath: string): boolean {
    const fileName = path.basename(filePath).toLowerCase();
    return fileName.endsWith('.pm.json') ||
           fileName.endsWith('.pm.hjson');
  }

  /**
   * 将新的提示数组推入累积数组中，避免使用扩展运算符导致的性能问题
   * @param accumulator 累积PromptProps的数组
   * @param newPrompts 新的PromptProps数组
   */
  private pushPrompts(accumulator: PromptProps[], newPrompts: PromptProps[]): void {
    accumulator.push(...newPrompts);
  }

  /**
   * 解析Prompt的内容，如果content是文件路径则加载其内容
   * @param prompt 单个PromptProps对象
   * @param baseDir 基础目录路径
   * @returns 处理后的PromptProps对象
   */
  private resolvePromptContent(prompt: PromptProps, baseDir: string): PromptProps {
    if (typeof prompt.content === 'string' && prompt.content.startsWith('/')) {
      prompt.content = loadContentFromFile(prompt.content, baseDir);
    }
    if (Array.isArray(prompt.subprompts)) {
      prompt.subprompts = prompt.subprompts.map(subprompt => this.resolvePromptContent(subprompt, baseDir));
    }
    return prompt;
  }

  /**
   * 处理和规范化所有提示
   * @param prompts 原始的PromptProps数组
   * @returns 规范化后的PromptProps数组
   */
  private processPrompts(prompts: PromptProps[]): PromptProps[] {
    return prompts.map(prompt => this.processPrompt(prompt));
  }

  /**
   * 规范化单个PromptProps对象
   * @param prompt 单个PromptProps对象
   * @returns 规范化后的PromptProps对象
   */
  private processPrompt(prompt: PromptProps): PromptProps {
    if (!prompt.identifier) {
      prompt.identifier = md5(prompt.title);
    }

    if (prompt.ref) {
      prompt.rawRef = { ...prompt.ref };
      prompt.options = {};
      prompt.textInputs = {};

      for (const [key, value] of Object.entries(prompt.ref)) {
        if (Array.isArray(value)) {
          prompt.options[key] = value;
        } else if (typeof value === 'string' && !value.startsWith('/')) {
          prompt.textInputs[key] = value;
        }
      }

      delete prompt.ref;
    }

    if (Array.isArray(prompt.subprompts)) {
      prompt.subprompts = prompt.subprompts.map(subprompt => this.processPrompt(subprompt));
    }

    return prompt;
  }

  /**
   * 获取所有根提示
   * @returns PromptProps数组
   */
  public getRootPrompts(): PromptProps[] {
    return this.prompts;
  }

  /**
   * 根据过滤函数获取过滤后的提示
   * @param filterFn 过滤函数
   * @returns 过滤后的PromptProps数组
   */
  public getFilteredPrompts(filterFn: (prompt: PromptProps) => boolean): PromptProps[] {
    const filteredPrompts: PromptProps[] = [];
    this.collectFilteredPrompts(this.prompts, filterFn, filteredPrompts);
    return filteredPrompts;
  }

  /**
   * 递归收集满足条件的提示
   * @param prompts 当前提示数组
   * @param filterFn 过滤函数
   * @param accumulator 满足条件的PromptProps数组
   */
  private collectFilteredPrompts(
    prompts: PromptProps[],
    filterFn: (prompt: PromptProps) => boolean,
    accumulator: PromptProps[]
  ): void {
    for (const prompt of prompts) {
      if (filterFn(prompt)) {
        accumulator.push(prompt);
      }
      if (Array.isArray(prompt.subprompts)) {
        this.collectFilteredPrompts(prompt.subprompts, filterFn, accumulator);
      }
    }
  }

  /**
   * 查找第一个满足条件的提示
   * @param filterFn 过滤函数
   * @returns 满足条件的PromptProps对象或undefined
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
}

const promptManager = new PromptManager();

export default promptManager;