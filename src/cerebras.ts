import Cerebras from '@cerebras/cerebras_cloud_sdk';

export async function chat(message: string): Promise<string> {
  const cerebras = new Cerebras({
    apiKey: "csk-f3ydpd23c4wxfnjwnwrdrtvh239455xd96tvp45jcjrwrnw4"
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
    max_completion_tokens: 1024,
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
