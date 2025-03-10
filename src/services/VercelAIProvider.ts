import { OpenAI } from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat';
import type { AIProvider, ChatOptions, ChatResponse } from './types';

export class VercelAIProvider implements AIProvider {
    readonly name: string;
    readonly defaultModel: string;
    readonly supportedModels: string[];
    private readonly client: OpenAI;
    private readonly apiKey: string;

    constructor(
        name: string,
        apiKey: string,
        defaultModel: string = 'gpt-3.5-turbo',
        supportedModels: string[] = ['gpt-3.5-turbo', 'gpt-4'],
        baseURL?: string
    ) {
        this.name = name;
        this.apiKey = apiKey;
        this.defaultModel = defaultModel;
        this.supportedModels = supportedModels;
        this.client = new OpenAI({
            apiKey: this.apiKey,
            baseURL: baseURL,
        });
    }

    getApiKey(): string {
        return this.apiKey;
    }

    async chat(message: string, options?: ChatOptions): Promise<ChatResponse> {
        const model = options?.model || this.defaultModel;
        const messages: ChatCompletionMessageParam[] = [
            {
                role: 'system',
                content: options?.systemPrompt || 'You are a helpful assistant',
            },
            {
                role: 'user',
                content: message,
            },
        ];

        try {
            if (options?.onStream) {
                const response = await this.client.chat.completions.create({
                    model,
                    messages,
                    stream: true,
                    temperature: options?.temperature,
                    max_tokens: options?.maxTokens,
                    top_p: options?.topP,
                });

                let fullContent = '';
                for await (const chunk of response) {
                    const content = chunk.choices[0]?.delta?.content || '';
                    if (content) {
                        fullContent += content;
                        options.onStream(content);
                    }
                }

                return {
                    content: fullContent,
                    model,
                    provider: this.name,
                };
            } else {
                const response = await this.client.chat.completions.create({
                    model,
                    messages,
                    temperature: options?.temperature,
                    max_tokens: options?.maxTokens,
                    top_p: options?.topP,
                });

                return {
                    content: response.choices[0]?.message?.content || '',
                    model,
                    provider: this.name,
                };
            }
        } catch (error) {
            console.error('Chat error:', error);
            throw error;
        }
    }
} 