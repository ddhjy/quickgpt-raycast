import { getPreferenceValues } from "@raycast/api";
import { BaseAIProvider } from "./base";

interface Preferences {
  sambanovaApiKey: string;
}

export class SambanovaProvider extends BaseAIProvider {
  name = 'sambanova';
  defaultModel = 'Meta-Llama-3.1-8B-Instruct';
  supportedModels = ['Meta-Llama-3.1-8B-Instruct'];
  protected apiEndpoint = 'https://api.sambanova.ai/v1/chat/completions';
  defaultSystemPrompt = 'You are a helpful AI assistant powered by SambaNova Meta-Llama. You aim to provide accurate and helpful responses.';
  
  getApiKey(): string {
    const preferences = getPreferenceValues<Preferences>();
    return preferences.sambanovaApiKey;
  }
} 