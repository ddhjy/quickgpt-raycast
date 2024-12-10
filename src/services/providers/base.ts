import { AIProvider, ChatOptions, ChatMessage } from "../types";
import fetch from "node-fetch";

export abstract class BaseAIProvider implements AIProvider {
  abstract name: string;
  abstract defaultModel: string;
  abstract supportedModels: string[];
  abstract getApiKey(): string;
  protected abstract apiEndpoint: string;
  defaultSystemPrompt = 'You are a helpful assistant';

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

  async chat(message: string, options?: ChatOptions): Promise<string> {
    const response = await fetch(this.apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.getApiKey()}`
      },
      body: JSON.stringify({
        messages: this.createMessages(message, options?.systemPrompt),
        model: options?.model || this.defaultModel,
        stream: true,
        ...(options?.maxTokens && { max_completion_tokens: options.maxTokens }),
        ...(options?.temperature && { temperature: options.temperature }),
        ...(options?.topP && { top_p: options.topP })
      })
    });

    if (!response.ok) {
      throw new Error(`API请求失败: ${response.statusText}`);
    }

    let result = '';
    const decoder = new TextDecoder('utf-8');

    try {
      for await (const chunk of response.body) {
        const text = decoder.decode(new Uint8Array(chunk as Buffer));
        const lines = text.split('\n').filter(line => line.trim());

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices[0]?.delta?.content || '';
              if (content) {
                result += content;
                options?.onStream?.(content);
              }
            } catch (e) {
              console.error('解析数据块失败:', e);
            }
          }
        }
      }
    } catch (error) {
      console.error('读取流数据时出错:', error);
      throw error;
    }

    return result;
  }
} 