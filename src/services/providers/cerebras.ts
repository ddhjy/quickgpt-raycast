import { getPreferenceValues } from "@raycast/api";
import fetch from "node-fetch";
import { AIProvider, ChatOptions } from "../types";

interface Preferences {
  cerebrasApiKey: string;
}

export class CerebrasProvider implements AIProvider {
  name = 'Cerebras';
  defaultModel = 'llama3.1-70b';
  supportedModels = ['llama3.1-70b'];
  
  private getApiKey(): string {
    const preferences = getPreferenceValues<Preferences>();
    return preferences.cerebrasApiKey;
  }

  async chat(message: string, options?: ChatOptions): Promise<string> {
    const response = await fetch('https://api.cerebras.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.getApiKey()}`
      },
      body: JSON.stringify({
        messages: [
          {
            role: "user",
            content: message
          }
        ],
        model: options?.model || this.defaultModel,
        stream: true,
        max_completion_tokens: options?.maxTokens || 4096,
        temperature: options?.temperature || 0.2,
        top_p: options?.topP || 1
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
              result += content;
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