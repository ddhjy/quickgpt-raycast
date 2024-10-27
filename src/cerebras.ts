import Cerebras from '@cerebras/cerebras_cloud_sdk';
import { getPreferenceValues } from "@raycast/api";

interface Preferences {
  cerebrasApiKey: string;
}

export async function chat(message: string): Promise<string> {
  const preferences = getPreferenceValues<Preferences>();
  
  const cerebras = new Cerebras({
    apiKey: preferences.cerebrasApiKey
  });

  const stream = await cerebras.chat.completions.create({
    messages: [
      {
        role: "user",
        content: message
      }
    ],
    model: 'llama3.1-70b',
    stream: true,
    max_completion_tokens: 2048,
    temperature: 0.2,
    top_p: 1
  });

  let result = '';
  for await (const chunk of stream) {
    const content = chunk?.choices?.[0]?.delta?.content || '';
    result += content;
  }
  
  return result;
}
