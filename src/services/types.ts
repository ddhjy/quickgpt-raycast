export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  model?: string;
  systemPrompt?: string;
}

export interface AIProvider {
  chat(message: string, options?: ChatOptions): Promise<string>;
  name: string;
  defaultModel: string;
  supportedModels: string[];
  defaultSystemPrompt?: string;
} 