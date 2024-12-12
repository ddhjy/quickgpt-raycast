import { AIProvider, ChatOptions, ChatMessage, ChatResponse } from "../types";
import { TokenJS } from 'token.js';

type Provider = "groq" | "openai" | "ai21" | "anthropic" | "gemini" | "cohere" | "bedrock" | "mistral" | "perplexity" | "openrouter" | "openai-compatible";

export abstract class BaseAIProvider implements AIProvider {
  abstract name: string;
  abstract defaultModel: string;
  abstract supportedModels: string[];
  abstract getApiKey(): string;
  protected abstract apiEndpoint: string;
  protected abstract provider: Provider;
  defaultSystemPrompt = 'You are a helpful assistant';
  protected tokenjs!: TokenJS;

  protected initializeTokenJS() {
    const apiKey = this.getApiKey();
    this.tokenjs = new TokenJS({
      baseURL: this.apiEndpoint,
      apiKey: apiKey
    });
  }

  protected createMessages(message: string, systemPrompt?: string): ChatMessage[] {
    return [
      {
        role: 'system',
        content: systemPrompt || this.defaultSystemPrompt
      },
      {
        role: 'user',
        content: message
      }
    ];
  }

  async chat(message: string, options?: ChatOptions): Promise<ChatResponse> {
    if (!this.tokenjs) {
      this.initializeTokenJS();
    }
    const model = options?.model || this.defaultModel;
    try {
      const completion = await this.tokenjs.chat.completions.create({
        provider: this.provider,
        model: model,
        messages: this.createMessages(message, options?.systemPrompt),
        stream: true,
        max_tokens: options?.maxTokens,
        temperature: options?.temperature,
        top_p: options?.topP
      });

      let result = '';
      for await (const part of completion) {
        const content = part.choices[0]?.delta?.content || '';
        if (content) {
          result += content;
          options?.onStream?.(content);
        }
      }
      return {
        content: result,
        model: model
      };
    } catch (error) {
      console.error('API请求失败:', {
        error,
        endpoint: this.apiEndpoint,
        model: model
      });
      throw error;
    }
  }
}