import type { AIProvider, ChatOptions, ChatResponse } from "./types";
import { ConfigurableProvider } from "./configurable";
import type { Provider } from "./base";
import * as fs from "fs";
import { getPreferenceValues } from "@raycast/api";

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
  providers: {
    [providerName: string]: ProviderConfig;
  };
}

interface Preferences {
  aiConfigPath?: string;
}

export class AIService {
  private static instance: AIService;
  private providers: Map<string, AIProvider>;
  private currentProvider!: AIProvider;
  private config: Config;
  private debug: boolean = false;

  private constructor() {
    this.providers = new Map();
    this.config = this.loadConfig();

    if (this.config.providers && Object.keys(this.config.providers).length > 0) {
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
          this.log(`Provider ${providerName} initialized successfully`);
        } catch (error) {
          this.log(`Failed to initialize provider ${providerName}:`, error);
        }
      }
    }

    if (this.providers.size > 0) {
      this.currentProvider = this.providers.values().next().value;
      this.log('Available providers:', this.getProviderNames());
      this.log('Current provider:', this.currentProvider.name);
    } else {
      this.log('No providers configured');
    }
  }

  private loadConfig(): Config {
    try {
      const preferences = getPreferenceValues<Preferences>();

      if (!preferences.aiConfigPath) {
        return {
          providers: {}
        };
      }

      if (fs.existsSync(preferences.aiConfigPath)) {
        this.log('Loading config from:', preferences.aiConfigPath);
        const configData = fs.readFileSync(preferences.aiConfigPath, "utf-8");
        const config = JSON.parse(configData) as Config;
        if (this.validateConfig(config)) {
          return config;
        }
      }

      throw new Error("No valid config file found");
    } catch (error) {
      this.log("Failed to load config.json", error);
      throw error;
    }
  }

  private validateConfig(config: unknown): config is Config {
    if (!config || typeof config !== 'object') {
      return false;
    }

    const typedConfig = config as Config;
    if (!typedConfig.providers || typeof typedConfig.providers !== 'object') {
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
    this.log('Getting provider:', normalizedName, 'Available:', this.getProviderNames());
    for (const [key, provider] of this.providers.entries()) {
      if (key.toLowerCase() === normalizedName) {
        return provider;
      }
    }
    return undefined;
  }

  setCurrentProvider(name: string): void {
    const normalizedName = name.toLowerCase();
    this.log('Setting provider:', normalizedName, 'Available:', this.getProviderNames());
    let provider: AIProvider | undefined;

    for (const [key, p] of this.providers.entries()) {
      if (key.toLowerCase() === normalizedName) {
        provider = p;
        break;
      }
    }

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

    this.log('Chat request:', {
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
      this.log('Chat response received:', {
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

  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log(...args);
    }
  }

  public setDebug(enabled: boolean): void {
    this.debug = enabled;
  }
}