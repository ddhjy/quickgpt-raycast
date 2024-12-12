import { getPreferenceValues } from "@raycast/api";
import { BaseAIProvider } from "./base";

interface Preferences {
  cerebrasApiKey: string;
}

export class CerebrasProvider extends BaseAIProvider {
  name = 'cerebras';
  defaultModel = 'llama3.1-70b';
  supportedModels = ['llama3.1-70b'];
  protected apiEndpoint = 'https://api.cerebras.ai/v1';
  protected provider = 'openai-compatible' as const;
  defaultSystemPrompt = 'You are a helpful AI assistant powered by Cerebras. You aim to provide accurate and helpful responses.';
  
  getApiKey(): string {
    const preferences = getPreferenceValues<Preferences>();
    return preferences.cerebrasApiKey;
  }
} 