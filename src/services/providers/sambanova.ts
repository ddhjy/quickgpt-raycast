import { getPreferenceValues } from "@raycast/api";
import { BaseAIProvider } from "./base";

interface Preferences {
  sambanovaApiKey: string;
}

export class SambanovaProvider extends BaseAIProvider {
  name = 'sambanova';
  defaultModel = 'Qwen2.5-Coder-32B-Instruct';
  supportedModels = ['Qwen2.5-Coder-32B-Instruct'];
  protected apiEndpoint = 'https://api.sambanova.ai/v1';
  protected provider = 'openai-compatible' as const;
  defaultSystemPrompt = 'You are a helpful AI assistant powered by SambaNova Meta-Llama. You aim to provide accurate and helpful responses.';
  
  getApiKey(): string {
    const preferences = getPreferenceValues<Preferences>();
    return preferences.sambanovaApiKey;
  }
}