import { AIProvider, ChatOptions } from "./types";
import { CerebrasProvider } from "./providers/cerebras";
import { SambanovaProvider } from "./providers/sambanova";

export class AIService {
  private static instance: AIService;
  private providers: Map<string, AIProvider>;
  private currentProvider: AIProvider;

  private constructor() {
    this.providers = new Map();
    
    // 注册提供商
    const cerebrasProvider = new CerebrasProvider();
    const sambanovaProvider = new SambanovaProvider();
    
    console.log('Registering providers:', cerebrasProvider.name, sambanovaProvider.name);
    
    this.providers.set(cerebrasProvider.name, cerebrasProvider);
    this.providers.set(sambanovaProvider.name, sambanovaProvider);
    
    // 默认使用 Cerebras
    this.currentProvider = cerebrasProvider;
    
    console.log('Available providers:', this.getProviderNames());
  }

  static getInstance(): AIService {
    if (!AIService.instance) {
      AIService.instance = new AIService();
    }
    return AIService.instance;
  }

  getProvider(name: string): AIProvider | undefined {
    const normalizedName = name.toLowerCase();
    console.log('Getting provider:', normalizedName, 'Available:', this.getProviderNames());
    return this.providers.get(normalizedName);
  }

  setCurrentProvider(name: string) {
    const normalizedName = name.toLowerCase();
    console.log('Setting provider:', normalizedName, 'Available:', this.getProviderNames());
    const provider = this.providers.get(normalizedName);
    if (!provider) {
      throw new Error(`Provider ${name} not found. Available providers: ${this.getProviderNames().join(', ')}`);
    }
    this.currentProvider = provider;
  }

  getCurrentProvider(): AIProvider {
    return this.currentProvider;
  }

  getAllProviders(): AIProvider[] {
    return Array.from(this.providers.values());
  }

  getProviderNames(): string[] {
    return Array.from(this.providers.keys());
  }

  async chat(message: string, options?: ChatOptions): Promise<string> {
    return this.currentProvider.chat(message, options);
  }
} 