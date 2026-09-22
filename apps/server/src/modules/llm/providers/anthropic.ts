import Anthropic from '@anthropic-ai/sdk';
import type { ProviderInfo } from '@crowd/shared';
import { type Completion, type CompletionRequest, type LlmProvider, ProviderError } from '../types';

const SUGGESTED = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'];

/** Models that take `output_config.effort` (Haiku 4.5 and Sonnet 4.5 reject it). */
const supportsEffort = (model: string) =>
  /^claude-(opus|fable|mythos|sonnet-5|sonnet-4-6)/.test(model);
/** Models with safety classifiers that can decline; for them a server-side fallback is requested. */
const supportsFallbacks = (model: string) => /^claude-(opus-5|fable-5|mythos-5)/.test(model);

/**
 * Claude through the official SDK. The answer is constrained by `output_config.format`
 * (JSON schema). Sampling parameters are not sent: current models reject `temperature`.
 * The system prompt is identical for every item in a job, so it is cached.
 */
export class AnthropicProvider implements LlmProvider {
  readonly id = 'anthropic' as const;
  private readonly client: Anthropic | null;

  constructor(
    apiKey: string | null,
    readonly defaultModel: string,
    timeoutMs: number,
  ) {
    this.client = apiKey ? new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 2 }) : null;
  }

  async describe(): Promise<ProviderInfo> {
    const models = [...new Set([this.defaultModel, ...SUGGESTED])].map((name) => ({
      name,
      detail: null,
    }));
    return {
      id: this.id,
      available: this.client != null,
      reason: this.client ? null : 'Set ANTHROPIC_API_KEY to enable Claude.',
      defaultModel: this.defaultModel,
      models,
    };
  }

  async complete(req: CompletionRequest): Promise<Completion> {
    if (!this.client) throw new ProviderError('ANTHROPIC_API_KEY is not set.', true);
    const started = performance.now();
    const params = {
      model: req.model,
      max_tokens: Math.max(req.maxTokens, 2048), // room for adaptive thinking plus the JSON
      system: req.system,
      messages: req.messages,
      cache_control: { type: 'ephemeral' as const },
      output_config: {
        ...(supportsEffort(req.model) ? { effort: 'low' as const } : {}),
        format: { type: 'json_schema' as const, schema: req.schema },
      },
    };
    try {
      const message = supportsFallbacks(req.model)
        ? await this.client.beta.messages.create(
            { ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' },
            { signal: req.signal },
          )
        : await this.client.messages.create(params, { signal: req.signal });

      if (message.stop_reason === 'refusal') {
        const category = message.stop_details?.category ?? 'unspecified';
        throw new ProviderError(`Claude declined this item (${category}).`, false);
      }
      if (message.stop_reason === 'max_tokens') {
        throw new ProviderError('The answer was cut off at max_tokens.', false);
      }
      let text = '';
      for (const block of message.content) {
        if (block.type === 'text') text += block.text;
      }
      return {
        text,
        model: `anthropic:${message.model}`,
        latencyMs: Math.round(performance.now() - started),
      };
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      if (
        err instanceof Anthropic.AuthenticationError ||
        err instanceof Anthropic.PermissionDeniedError ||
        err instanceof Anthropic.NotFoundError
      ) {
        throw new ProviderError(`Claude API: ${err.message}`, true);
      }
      if (err instanceof Anthropic.BadRequestError) {
        // A malformed request is malformed for every item.
        throw new ProviderError(`Claude API rejected the request: ${err.message}`, true);
      }
      if (err instanceof Anthropic.RateLimitError) {
        throw new ProviderError('Claude API rate limit reached (after retries).', false);
      }
      if (err instanceof Anthropic.APIConnectionError && !req.signal?.aborted) {
        throw new ProviderError(`Cannot reach the Claude API: ${err.message}`, false);
      }
      if (err instanceof Anthropic.APIError) {
        throw new ProviderError(`Claude API error ${err.status ?? ''}: ${err.message}`, false);
      }
      throw err;
    }
  }
}
