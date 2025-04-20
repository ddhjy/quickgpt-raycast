import { OpenAI } from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat';
import type { AIProvider, ChatOptions, ChatResponse } from './types';

/**
 * Implements the AIProvider interface for interacting with OpenAI-compatible APIs,
 * typically proxied through Vercel AI SDK or similar services.
 * Handles API key management, message formatting, chat requests (streaming and non-streaming).
 */
export class VercelAIProvider implements AIProvider {
    readonly name: string;
    readonly defaultModel: string;
    readonly supportedModels: string[];
    private readonly client: OpenAI;
    private readonly apiKey: string;

    /**
     * Initializes a new instance of the VercelAIProvider.
     *
     * @param name The display name for this provider instance.
     * @param apiKey The API key for authentication.
     * @param defaultModel The default model identifier to use if not specified in options (e.g., 'gpt-3.5-turbo').
     * @param supportedModels An array of model identifiers supported by this provider endpoint.
     * @param baseURL Optional custom base URL for the OpenAI-compatible API endpoint.
     */
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

    /**
     * Retrieves the API key associated with this provider instance.
     *
     * @returns The API key string.
     */
    getApiKey(): string {
        return this.apiKey;
    }

    /**
     * Creates the configuration object for an OpenAI chat completion request.
     *
     * @param messages The array of messages forming the conversation history.
     * @param options Optional chat settings (model, temperature, etc.) to override defaults.
     * @returns The configuration object for the `client.chat.completions.create` call.
     */
    private createCompletionConfig(messages: ChatCompletionMessageParam[], options?: ChatOptions) {
        return {
            model: options?.model || this.defaultModel,
            messages,
            temperature: options?.temperature,
            max_tokens: options?.maxTokens,
            top_p: options?.topP,
        };
    }

    /**
     * Formats the user message and optional system prompt into the structure required by the OpenAI API.
     *
     * @param message The user's input message.
     * @param systemPrompt Optional system prompt to guide the AI's behavior.
     * @returns An array of ChatCompletionMessageParam objects.
     */
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

    /**
     * Sends a chat request to the configured OpenAI-compatible endpoint.
     * Handles both streaming and non-streaming responses based on the provided options.
     *
     * @param message The user's input message.
     * @param options Optional chat configuration, including a potential `onStream` callback for streaming.
     * @returns A promise resolving to the ChatResponse containing the AI's reply.
     * @throws Any error encountered during the API request.
     */
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

    /**
     * Handles a streaming chat response from the API.
     * Iterates through the stream chunks, calls the `onStream` callback with content deltas,
     * and aggregates the full response content.
     *
     * @param config The chat completion configuration.
     * @param onStream The callback function to handle incoming stream chunks.
     * @returns A promise resolving to the final ChatResponse once the stream is complete.
     */
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

    /**
     * Handles a non-streaming chat response from the API.
     * Makes a single request and extracts the content from the response.
     *
     * @param config The chat completion configuration.
     * @returns A promise resolving to the ChatResponse.
     */
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