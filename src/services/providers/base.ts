import { AIProvider, ChatOptions, ChatMessage, ChatResponse } from "../types";
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

  async chat(message: string, options?: ChatOptions): Promise<ChatResponse> {
    const model = options?.model || this.defaultModel;
    const response = await fetch(this.apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.getApiKey()}`
      },
      body: JSON.stringify({
        messages: this.createMessages(message, options?.systemPrompt),
        model: model,
        stream: true,
        ...(options?.maxTokens && { max_completion_tokens: options.maxTokens }),
        ...(options?.temperature && { temperature: options.temperature }),
        ...(options?.topP && { top_p: options.topP })
      })
    });

    if (!response.ok) {
      throw new Error(`API请求失败: ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    let result = '';
    let buffer = '';

    return new Promise((resolve, reject) => {
      response.body.on('readable', () => {
        let chunk;
        while (null !== (chunk = response.body.read())) {
          const text = chunk.toString();
          buffer += text;
          
          let newlineIndex;
          while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);
            
            if (!line) continue;
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
                console.error('解析数据块失败:', e, line);
              }
            }
          }
        }
      });

      response.body.on('end', () => {
        resolve({
          content: result,
          model: model
        });
      });

      response.body.on('error', (error) => {
        console.error('读取流数据时出错:', error);
        reject(error);
      });
    });
  }
} 