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
    console.log('初始化 TokenJS...');
    const apiKey = this.getApiKey();
    console.log('API Endpoint:', this.apiEndpoint);
    console.log('API Key 长度:', apiKey?.length || 0);

    try {
      this.tokenjs = new TokenJS({
        baseURL: this.apiEndpoint,
        apiKey: apiKey
      });
      console.log('TokenJS 初始化成功');
    } catch (error) {
      console.error('TokenJS 初始化失败:', error);
      throw error;
    }
  }

  protected createMessages(message: string, systemPrompt?: string): ChatMessage[] {
    console.log('创建消息:', {
      systemPrompt: systemPrompt || "默认系统提示",
      messageLength: message?.length || 0
    });

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
    console.log('开始聊天请求...', {
      provider: this.provider,
      hasTokenJS: !!this.tokenjs,
      messageLength: message?.length || 0,
      options: {
        model: options?.model,
        maxTokens: options?.maxTokens,
        temperature: options?.temperature,
        topP: options?.topP
      }
    });

    if (!this.tokenjs) {
      console.log('TokenJS 未初始化,正在初始化...');
      this.initializeTokenJS();
    }

    const model = options?.model || this.defaultModel;
    const systemPrompt = options?.systemPrompt;

    try {
      console.log('发送聊天请求:', {
        model,
        systemPromptLength: systemPrompt?.length || 0
      });

      const completion = await this.tokenjs.chat.completions.create({
        provider: this.provider,
        model: model,
        messages: this.createMessages(message, systemPrompt),
        stream: true,
        max_tokens: options?.maxTokens,
        temperature: options?.temperature,
        top_p: options?.topP
      });

      console.log('请求成功,开始处理流式响应');
      let result = '';
      let chunkCount = 0;

      for await (const part of completion as AsyncIterable<CompletionPart>) {
        const content = part.choices[0]?.delta?.content || '';
        if (content) {
          result += content;
          chunkCount++;
          options?.onStream?.(content);
        }
      }

      console.log('流式响应处理完成', {
        totalChunks: chunkCount,
        resultLength: result.length
      });

      return {
        content: result,
        model: model
      };
    } catch (error) {
      console.error('API请求失败:', {
        error,
        errorName: (error as Error).name,
        errorMessage: (error as Error).message,
        errorStack: (error as Error).stack,
        endpoint: this.apiEndpoint,
        model: model,
        provider: this.provider,
        globalFetch: typeof fetch !== 'undefined' ? '可用' : '未定义'
      });
      throw error;
    }
  }
}