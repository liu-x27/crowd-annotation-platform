import type { LlmOverrides, LlmProviderId, LlmSettings, ProviderInfo } from '@crowd/shared';
import type { Config } from '../../config';
import { AnthropicProvider } from './providers/anthropic';
import { MockProvider } from './providers/mock';
import { OllamaProvider } from './providers/ollama';
import { OpenAiCompatibleProvider } from './providers/openai';
import type { LlmProvider } from './types';

export class LlmRegistry {
  private readonly providers: Map<LlmProviderId, LlmProvider>;

  constructor(
    config: Config,
    extra: LlmProvider[] = [],
    readonly concurrency = config.llmConcurrency,
  ) {
    const all: LlmProvider[] = [
      new OllamaProvider(config.ollama.baseUrl, config.ollama.model, config.llmTimeoutMs),
      new AnthropicProvider(config.anthropic.apiKey, config.anthropic.model, config.llmTimeoutMs),
      new OpenAiCompatibleProvider(
        config.openai.baseUrl,
        config.openai.apiKey,
        config.openai.model,
        config.llmTimeoutMs,
      ),
      new MockProvider(),
      ...extra,
    ];
    this.providers = new Map(all.map((p) => [p.id, p]));
  }

  get(id: LlmProviderId): LlmProvider {
    const provider = this.providers.get(id);
    if (!provider) throw new Error(`unknown provider ${id}`);
    return provider;
  }

  describeAll(): Promise<ProviderInfo[]> {
    return Promise.all([...this.providers.values()].map((p) => p.describe()));
  }

  /** Project settings with per-run overrides applied, and the model resolved. */
  resolve(
    settings: LlmSettings,
    overrides: LlmOverrides = {},
  ): LlmSettings & { provider: LlmProviderId; model: string } {
    const merged = {
      provider: overrides.provider ?? settings.provider,
      model: overrides.model ?? settings.model,
      temperature: overrides.temperature ?? settings.temperature,
      fewShot: overrides.fewShot ?? settings.fewShot,
      instructions: overrides.instructions ?? settings.instructions,
    };
    const provider = this.get(merged.provider);
    return { ...merged, model: merged.model || provider.defaultModel };
  }
}
