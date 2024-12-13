import type { AIProvider, ChatOptions, ChatResponse } from "./types";
import { ConfigurableProvider } from "./providers/configurable";
import type { Provider } from "./providers/base";
import * as fs from "fs";
import * as path from "path";

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

    for (const [providerName, providerConfig] of Object.entries(this.config.providers)) {
      const provider = new ConfigurableProvider(
        providerName,
        providerConfig.apiEndpoint,
        providerConfig.provider,
        providerConfig.model,
        [providerConfig.model]
      );
      this.providers.set(providerName, provider);
    }

    const activeProvider = this.getProvider(this.config.activeProvider);
    if (!activeProvider) {
      throw new Error(`Active provider ${this.config.activeProvider} not found in config`);
    }
    this.currentProvider = activeProvider;

    console.log('Available providers:', this.getProviderNames());
    console.log('Current provider:', this.currentProvider.name);
  }

  private loadConfig(): Config {
    try {
      const configPath = path.join(__dirname, "../config.json");
      const configData = fs.readFileSync(configPath, "utf-8");
      return JSON.parse(configData) as Config;
    } catch (error) {
      console.error("Failed to load config.json, using default settings.", error);
      return {
        activeProvider: "cerebras",
        providers: {
          cerebras: {
            apiKey: "",
            model: "llama3.1-70b",
            defaultSystemPrompt: "You are a helpful AI assistant powered by Cerebras.",
            apiEndpoint: 'https://api.cerebras.ai/v1',
            provider: 'openai-compatible'
          },
          sambanova: {
            apiKey: "",
            model: "Qwen2.5-Coder-32B-Instruct",
            defaultSystemPrompt: "You are a helpful AI assistant powered by SambaNova Meta-Llama.",
            apiEndpoint: 'https://api.sambanova.ai/v1',
            provider: 'openai-compatible'
          },
          groq: {
            apiKey: "",
            model: "llama-3.3-70b-versatile",
            defaultSystemPrompt: "You are a helpful AI assistant powered by Groq LLaMA.",
            apiEndpoint: 'https://api.groq.com/openai/v1',
            provider: 'openai-compatible'
          },
          gemini: {
            apiKey: "",
            model: "gemini-1.5-pro",
            defaultSystemPrompt: "You are a helpful AI assistant powered by Google Gemini.",
            apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta',
            provider: 'gemini'
          }
        },
      };
    }
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

    const chatOptions: ChatOptions = {
      ...options,
      ...providerConfig.options,
      model: options?.model || providerConfig.model,
      systemPrompt: options?.systemPrompt || providerConfig.defaultSystemPrompt
    };
    return this.currentProvider.chat(message, chatOptions);
  }
}