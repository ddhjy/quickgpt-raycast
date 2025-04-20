import type { AIProvider, ChatOptions, ChatResponse } from "./types";
import { VercelAIProvider } from "./VercelAIProvider";
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
  apiEndpoint?: string;
}

interface Config {
  providers: {
    [providerName: string]: ProviderConfig;
  };
}

interface Preferences {
  aiConfigPath?: string;
}

/**
 * Singleton service responsible for managing and interacting with different AI providers.
 * Loads provider configurations from a JSON file specified in preferences,
 * initializes provider instances (currently only VercelAIProvider),
 * and routes chat requests to the currently selected provider.
 */
export class AIService {
  private static instance: AIService;
  private providers: Map<string, AIProvider>;
  private currentProvider!: AIProvider;
  private config: Config;
  private debug: boolean = false;

  /**
   * Private constructor to enforce the singleton pattern.
   * Initializes the provider map, loads the configuration file,
   * instantiates configured providers, and sets the default provider.
   */
  private constructor() {
    this.providers = new Map();
    this.config = this.loadConfig();

    if (this.config.providers && Object.keys(this.config.providers).length > 0) {
      for (const [providerName, providerConfig] of Object.entries(this.config.providers)) {
        try {
          const provider = new VercelAIProvider(
            providerName,
            providerConfig.apiKey,
            providerConfig.model,
            [providerConfig.model],
            providerConfig.apiEndpoint
          );
          this.providers.set(providerName, provider);
          this.log(`Provider ${providerName} initialized successfully`);
        } catch (error) {
          this.log(`Failed to initialize provider ${providerName}:`, error);
        }
      }
    }

    if (this.providers.size > 0) {
      const firstProvider = this.providers.values().next().value;
      if (!firstProvider) {
        throw new Error('No provider available');
      }
      this.currentProvider = firstProvider;
      this.log('Available providers:', this.getProviderNames());
      this.log('Current provider:', this.currentProvider.name);
    } else {
      this.log('No providers configured');
    }
  }

  /**
   * Loads the AI provider configuration from the JSON file specified in preferences.
   * Handles cases where the path is not set or the file doesn't exist.
   * Validates the loaded configuration structure.
   *
   * @returns The loaded and validated configuration object.
   * @throws Error if the configuration path is not set, the file is not found, or the config is invalid.
   */
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

  /**
   * Validates the basic structure of the loaded configuration object.
   * Checks for the presence and type of the main `providers` object.
   *
   * @param config The configuration object to validate.
   * @returns True if the basic structure is valid, false otherwise.
   */
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

  /**
   * Returns the singleton instance of the AIService.
   * Creates the instance if it doesn't exist yet.
   *
   * @returns The singleton AIService instance.
   */
  static getInstance(): AIService {
    if (!AIService.instance) {
      AIService.instance = new AIService();
    }
    return AIService.instance;
  }

  /**
   * Retrieves a specific AI provider instance by its name (case-insensitive).
   *
   * @param name The name of the provider to retrieve.
   * @returns The AIProvider instance, or undefined if not found.
   */
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

  /**
   * Sets the currently active AI provider by its name (case-insensitive).
   *
   * @param name The name of the provider to set as current.
   * @throws Error if the provider with the given name is not found.
   */
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

  /**
   * Gets the currently active AI provider instance.
   *
   * @returns The current AIProvider instance.
   */
  getCurrentProvider(): AIProvider {
    return this.currentProvider;
  }

  /**
   * Gets a list of all initialized AI provider instances.
   *
   * @returns An array containing all AIProvider instances.
   */
  getAllProviders(): AIProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Gets the names of all initialized AI providers.
   *
   * @returns An array of strings containing the names of all providers.
   */
  getProviderNames(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Sends a chat message to the currently active AI provider.
   * Merges provided options with the provider's default configuration.
   * Handles potential errors during the chat request.
   *
   * @param message The user message to send to the AI.
   * @param options Optional chat configuration overrides (e.g., model, temperature, system prompt, streaming callback).
   * @returns A promise resolving to the ChatResponse object from the provider.
   * @throws Error if configuration for the current provider is missing or if the provider throws an error.
   */
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

  /**
   * Logs messages to the console if debugging is enabled.
   *
   * @param args Arguments to log.
   */
  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log(...args);
    }
  }

  /**
   * Enables or disables debug logging for the AIService.
   *
   * @param enabled True to enable debug logging, false to disable.
   */
  public setDebug(enabled: boolean): void {
    this.debug = enabled;
  }
}