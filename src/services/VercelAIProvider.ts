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

    private createCompletionConfig(messages: ChatCompletionMessageParam[], options?: ChatOptions) {
        return {
            model: options?.model || this.defaultModel,
            messages,
            temperature: options?.temperature,
            max_tokens: options?.maxTokens,
            top_p: options?.topP,
        };
    }

    private createMessages(message: string, systemPrompt?: string): ChatCompletionMessageParam[] {
        return [
            {
                role: 'system',
                content: systemPrompt || 'You are a helpful assistant',
            },
            {
                role: 'user',
                content: message,
            },
        ];
    }

    async chat(message: string, options?: ChatOptions): Promise<ChatResponse> {
        const messages = this.createMessages(message, options?.systemPrompt);
        const config = this.createCompletionConfig(messages, options);

        try {
            if (options?.onStream) {
                return await this.handleStreamingResponse(config, options.onStream);
            }
            return await this.handleNonStreamingResponse(config);
        } catch (error) {
            console.error('Chat error:', error);
            throw error;
        }
    }

    private async handleStreamingResponse(
        config: ReturnType<typeof this.createCompletionConfig>,
        onStream: NonNullable<ChatOptions['onStream']>
    ): Promise<ChatResponse> {
        const response = await this.client.chat.completions.create({
            ...config,
            stream: true,
        });

        let fullContent = '';
        for await (const chunk of response) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) {
                fullContent += content;
                onStream(content);
            }
        }

        return {
            content: fullContent,
            model: config.model,
            provider: this.name,
        };
    }

    private async handleNonStreamingResponse(
        config: ReturnType<typeof this.createCompletionConfig>
    ): Promise<ChatResponse> {
        const response = await this.client.chat.completions.create(config);
        return {
            content: response.choices[0]?.message?.content || '',
            model: config.model,
            provider: this.name,
        };
    }
} 