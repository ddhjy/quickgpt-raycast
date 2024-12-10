import { getPreferenceValues } from "@raycast/api";
import { BaseAIProvider } from "./base";

interface Preferences {
  groqApiKey: string;
}

export class GroqProvider extends BaseAIProvider {
  name = 'groq';
  defaultModel = 'llama-3.3-70b-versatile';
  supportedModels = [
    'llama-3.3-70b-versatile',
    'mixtral-8x7b-32768',
    'gemma-7b-it'
  ];
  protected apiEndpoint = 'https://api.groq.com/openai/v1/chat/completions';
  defaultSystemPrompt = 'You are a helpful AI assistant powered by Groq LLaMA. You aim to provide accurate and helpful responses.';
  
  getApiKey(): string {
    const preferences = getPreferenceValues<Preferences>();
    return preferences.groqApiKey;
  }
} 