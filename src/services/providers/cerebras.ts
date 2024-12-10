import { getPreferenceValues } from "@raycast/api";
import { BaseAIProvider } from "./base";

interface Preferences {
  cerebrasApiKey: string;
}

export class CerebrasProvider extends BaseAIProvider {
  name = 'Cerebras';
  defaultModel = 'llama3.1-70b';
  supportedModels = ['llama3.1-70b'];
  protected apiEndpoint = 'https://api.cerebras.ai/v1/chat/completions';
  
  getApiKey(): string {
    const preferences = getPreferenceValues<Preferences>();
    return preferences.cerebrasApiKey;
  }
} 