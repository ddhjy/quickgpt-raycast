import { BaseAIProvider, Provider } from "./base";

export class ConfigurableProvider extends BaseAIProvider {
  readonly name: string;
  protected apiEndpoint: string;
  protected provider: Provider;
  readonly defaultModel: string;
  readonly supportedModels: string[];
  private readonly apiKey: string;

  constructor(
    name: string, 
    apiEndpoint: string,
    provider: Provider,
    defaultModel: string,
    supportedModels: string[],
    apiKey: string
  ) {
    super();
    this.name = name;
    this.apiEndpoint = apiEndpoint;
    this.provider = provider;
    this.defaultModel = defaultModel;
    this.supportedModels = supportedModels;
    this.apiKey = apiKey;
  }

  getApiKey(): string {
    return this.apiKey;
  }
}
