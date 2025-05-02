export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatResponse {
  content: string;
  model: string;
  provider?: string;
}

export interface ChatOptions {
  model?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  onStream?: (chunk: string) => void;
}

export interface AIProvider {
  readonly name: string;
  readonly defaultModel: string;
  readonly supportedModels: string[];

  chat(message: string, options?: ChatOptions): Promise<ChatResponse>;
  getApiKey(): string;
}