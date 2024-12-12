import { getPreferenceValues } from "@raycast/api";
import { BaseAIProvider } from "./base";

interface Preferences {
    geminiApiKey: string;
}

export class GeminiProvider extends BaseAIProvider {
    name = 'gemini';
    defaultModel = 'gemini-1.5-pro';
    supportedModels = ['gemini-1.5-pro'];
    protected apiEndpoint = 'https://generativelanguage.googleapis.com/v1beta';
    protected provider = 'gemini' as const;
    defaultSystemPrompt = 'You are a helpful AI assistant powered by Google Gemini. You aim to provide accurate and helpful responses.';

    getApiKey(): string {
        const preferences = getPreferenceValues<Preferences>();
        return preferences.geminiApiKey;
    }
}