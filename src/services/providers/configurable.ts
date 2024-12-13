import type { AIProvider, ChatOptions, ChatResponse } from "../types";
import type { Provider } from "./base";
import { getPreferenceValues } from "@raycast/api";

interface ConfigurableProviderPreferences {
  [key: string]: string;
}

export class ConfigurableProvider implements AIProvider {
  readonly name: string;
  readonly apiEndpoint: string;
  readonly provider: Provider;
  readonly defaultModel: string;
  readonly supportedModels: string[];

  constructor(
    name: string,
    apiEndpoint: string,
    provider: Provider,
    defaultModel: string,
    supportedModels: string[]
  ) {
    this.name = name;
    this.apiEndpoint = apiEndpoint;
    this.provider = provider;
    this.defaultModel = defaultModel;
    this.supportedModels = supportedModels;
  }
    
  getApiKey(): string {
    const preferences = getPreferenceValues<ConfigurableProviderPreferences>();
    const apiKey = preferences[`${this.name}ApiKey`];
    if (!apiKey) {
      throw new Error(`API key not found for provider ${this.name}`);
    }
    return apiKey;
  }

  async chat(message: string, options?: ChatOptions): Promise<ChatResponse> {
    // 根据 provider 类型调用相应的聊天实现
    if (this.provider === 'openai-compatible') {
      // 实现 OpenAI 兼容的聊天逻辑
      return this.chatOpenAICompatible(message, options);
    } else if (this.provider === 'gemini') {
      // 实现 Gemini 的聊天逻辑
      return this.chatGemini(message, options);
    }
    throw new Error(`Unsupported provider type: ${this.provider}`);
  }

  private async chatOpenAICompatible(message: string, options?: ChatOptions): Promise<ChatResponse> {
    // OpenAI 兼容的聊天实现
    const response = await fetch(`${this.apiEndpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.getApiKey()}`
      },
      body: JSON.stringify({
        model: options?.model || this.defaultModel,
        messages: [
          { role: 'system', content: options?.systemPrompt || 'You are a helpful assistant.' },
          { role: 'user', content: message }
        ],
        temperature: options?.temperature || 0.7,
        max_tokens: options?.maxTokens,
        top_p: options?.topP
      })
    });

    const data = await response.json();
    return {
      content: data.choices[0].message.content,
      model: data.model,
      provider: this.name
    };
  }

  private async chatGemini(message: string, options?: ChatOptions): Promise<ChatResponse> {
    // Gemini 的聊天实现
    const response = await fetch(`${this.apiEndpoint}/models/${options?.model || this.defaultModel}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.getApiKey()
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: message
          }]
        }],
        generationConfig: {
          temperature: options?.temperature,
          topP: options?.topP,
          maxOutputTokens: options?.maxTokens
        }
      })
    });

    const data = await response.json();
    return {
      content: data.candidates[0].content.parts[0].text,
      model: options?.model || this.defaultModel,
      provider: this.name
    };
  }
}
