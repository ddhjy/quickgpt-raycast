import { TokenJS } from 'token.js';
import type { AIProvider, ChatOptions, ChatMessage, ChatResponse } from "../types";

export type Provider = "groq" | "openai" | "ai21" | "anthropic" | "gemini" | "cohere" | "bedrock" | "mistral" | "perplexity" | "openrouter" | "openai-compatible";

interface CompletionPart {
  choices: Array<{
    delta: {
      content?: string;
    };
  }>;
}

export abstract class BaseAIProvider implements AIProvider {
  abstract name: string;
  protected abstract apiEndpoint: string;
  protected abstract provider: Provider;
  protected tokenjs!: TokenJS;
  
  abstract defaultModel: string;
  abstract supportedModels: string[];
  
  abstract getApiKey(): string;

  protected initializeTokenJS(): void {
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
        content: systemPrompt || "You are a helpful assistant"
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
    const systemPrompt = options?.systemPrompt;

    try {
      const completion = await this.tokenjs.chat.completions.create({
        provider: this.provider,
        model: model,
        messages: this.createMessages(message, systemPrompt),
        stream: true,
        max_tokens: options?.maxTokens,
        temperature: options?.temperature,
        top_p: options?.topP
      });

      let result = '';
      for await (const part of completion as AsyncIterable<CompletionPart>) {
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