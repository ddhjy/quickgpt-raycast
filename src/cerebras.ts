import { getPreferenceValues } from "@raycast/api";
import fetch from "node-fetch";

interface Preferences {
  cerebrasApiKey: string;
}

export async function chat(message: string): Promise<string> {
  const preferences = getPreferenceValues<Preferences>();

  const response = await fetch('https://api.cerebras.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${preferences.cerebrasApiKey}`
    },
    body: JSON.stringify({
      messages: [
        {
          role: "user",
          content: message
        }
      ],
      model: 'llama3.1-70b',
      stream: true,
      max_completion_tokens: 4096,
      temperature: 0.2,
      top_p: 1
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