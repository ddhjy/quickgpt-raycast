import { AIProvider, ChatOptions } from "./types";
import { CerebrasProvider } from "./providers/cerebras";

export class AIService {
  private static instance: AIService;
  private providers: Map<string, AIProvider>;
  private currentProvider: AIProvider;

  private constructor() {
    this.providers = new Map();
    // 注册提供商
    const cerebrasProvider = new CerebrasProvider();
    this.providers.set(cerebrasProvider.name, cerebrasProvider);
    
    // 默认使用 Cerebras
    this.currentProvider = cerebrasProvider;
  }

  static getInstance(): AIService {
    if (!AIService.instance) {
      AIService.instance = new AIService();
    }
    return AIService.instance;
  }

  getProvider(name: string): AIProvider | undefined {
    return this.providers.get(name);
  }

  setCurrentProvider(name: string) {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new Error(`Provider ${name} not found`);
    }
    this.currentProvider = provider;
  }

  getCurrentProvider(): AIProvider {
    return this.currentProvider;
  }

  getAllProviders(): AIProvider[] {
    return Array.from(this.providers.values());
  }

  async chat(message: string, options?: ChatOptions): Promise<string> {
    return this.currentProvider.chat(message, options);
  }
} 