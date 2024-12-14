import type { AIProvider, ChatOptions, ChatResponse } from "./types";
import { ConfigurableProvider } from "./providers/configurable";
import type { Provider } from "./providers/base";
import * as fs from "fs";
import * as path from "path";
import { environment } from "@raycast/api";

interface ProviderConfig {
  apiKey: string;
  model: string;
  defaultSystemPrompt: string;
  options?: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
  };
  apiEndpoint: string;
  provider: Provider;
}

interface Config {
  activeProvider: string;
  providers: {
    [providerName: string]: ProviderConfig;
  };
}

export class AIService {
  private static instance: AIService;
  private providers: Map<string, AIProvider>;
  private currentProvider: AIProvider;
  private config: Config;

  private constructor() {
    this.providers = new Map();
    this.config = this.loadConfig();

    if (!this.config.providers || Object.keys(this.config.providers).length === 0) {
      throw new Error('No providers found in config');
    }

    for (const [providerName, providerConfig] of Object.entries(this.config.providers)) {
      try {
        const provider = new ConfigurableProvider(
          providerName,
          providerConfig.apiEndpoint,
          providerConfig.provider,
          providerConfig.model,
          [providerConfig.model],
          providerConfig.apiKey
        );
        this.providers.set(providerName, provider);
        console.log(`Provider ${providerName} initialized successfully`);
      } catch (error) {
        console.error(`Failed to initialize provider ${providerName}:`, error);
      }
    }

    if (this.providers.size === 0) {
      throw new Error('No providers could be initialized');
    }

    const activeProvider = this.getProvider(this.config.activeProvider);
    if (!activeProvider) {
      console.warn(`Active provider ${this.config.activeProvider} not found, using first available provider`);
      this.currentProvider = this.providers.values().next().value;
    } else {
      this.currentProvider = activeProvider;
    }

    console.log('Available providers:', this.getProviderNames());
    console.log('Current provider:', this.currentProvider.name);
  }

  private loadConfig(): Config {
    try {
      const configPath = path.join(environment.assetsPath, "config.json");
      if (fs.existsSync(configPath)) {
        console.log('Loading config from:', configPath);
        const configData = fs.readFileSync(configPath, "utf-8");
        const config = JSON.parse(configData) as Config;
        if (this.validateConfig(config)) {
          return config;
        }
      }
      
      throw new Error("No valid config file found");
    } catch (error) {
      console.error("Failed to load config.json", error);
      throw error;
    }
  }

  private validateConfig(config: unknown): config is Config {
    if (!config || typeof config !== 'object') {
      return false;
    }

    const typedConfig = config as Config;
    if (!typedConfig.activeProvider || !typedConfig.providers || typeof typedConfig.providers !== 'object') {
      return false;
    }

    return true;
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

  setCurrentProvider(name: string): void {
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

  async chat(message: string, options?: ChatOptions): Promise<ChatResponse> {
    const providerConfig = this.config.providers[this.currentProvider.name];
    if (!providerConfig) {
      throw new Error(`Configuration not found for provider ${this.currentProvider.name}`);
    }

    console.log('Chat request:', {
      provider: this.currentProvider.name,
      message: message.substring(0, 100) + '...',
      options: {
        ...options,
        systemPrompt: options?.systemPrompt ? '(set)' : '(not set)'
      }
    });

    const chatOptions: ChatOptions = {
      ...options,
      ...providerConfig.options,
      model: options?.model || providerConfig.model,
      systemPrompt: options?.systemPrompt || providerConfig.defaultSystemPrompt
    };

    try {
      const response = await this.currentProvider.chat(message, chatOptions);
      console.log('Chat response received:', {
        success: true,
        responseLength: response.content.length
      });
      return response;
    } catch (error) {
      console.error('Chat error:', {
        provider: this.currentProvider.name,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }
}