export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatResponse {
  content: string;
  model: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  model?: string;
  systemPrompt?: string;
  onStream?: (text: string) => void;
}

export interface AIProvider {
  chat(message: string, options?: ChatOptions): Promise<ChatResponse>;
  name: string;
  defaultModel: string;
  supportedModels: string[];
  defaultSystemPrompt?: string;
} 