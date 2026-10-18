import type { ProviderInfo } from '@crowd/shared';
import {
  type Completion,
  type CompletionRequest,
  type LlmProvider,
  ProviderError,
  withTimeout,
} from '../types';

/** The least max_tokens sent, whatever the task needs for its answer alone. */
const THINKING_ROOM = 4096;

/**
 * Any server that speaks the OpenAI chat-completions dialect: vLLM, LM Studio, llama.cpp's
 * server, or a hosted non-Anthropic model. Asks for `json_schema` output and falls back to
 * `json_object`, then to no constraint, for servers that do not support it; the answer is
 * validated either way.
 *
 * A model that thinks before answering (qwen3 through Ollama's /v1, say) spends tokens the
 * answer never shows, and a cap sized for the answer alone cuts it off before the answer
 * begins: Ollama then returns an empty message with finish_reason "length". Unlike Ollama's
 * own API, the OpenAI dialect has no portable way to ask a model not to think, so the cap
 * leaves room for it, and an answer that was cut off is reported as that.
 */
export class OpenAiCompatibleProvider implements LlmProvider {
  readonly id = 'openai' as const;
  private responseFormat: 'json_schema' | 'json_object' | 'none' = 'json_schema';

  constructor(
    private readonly baseUrl: string | null,
    private readonly apiKey: string | null,
    readonly defaultModel: string,
    private readonly timeoutMs: number,
  ) {}

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
    };
  }

  async describe(): Promise<ProviderInfo> {
    if (!this.baseUrl) {
      return {
        id: this.id,
        available: false,
        reason:
          'Set OPENAI_BASE_URL (for example http://localhost:1234/v1) to use an OpenAI-compatible server.',
        defaultModel: this.defaultModel,
        models: [],
      };
    }
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { data = [] } = (await res.json()) as { data?: { id: string }[] };
      return {
        id: this.id,
        available: true,
        reason: null,
        defaultModel: this.defaultModel || data[0]?.id || '',
        models: data.map((m) => ({ name: m.id, detail: null })),
      };
    } catch (err) {
      return {
        id: this.id,
        available: false,
        reason: `${this.baseUrl} is not reachable (${err instanceof Error ? err.message : err}).`,
        defaultModel: this.defaultModel,
        models: [],
      };
    }
  }

  async complete(req: CompletionRequest): Promise<Completion> {
    if (!this.baseUrl) throw new ProviderError('OPENAI_BASE_URL is not set.', true);
    const started = performance.now();
    for (;;) {
      const format =
        this.responseFormat === 'json_schema'
          ? {
              response_format: {
                type: 'json_schema',
                json_schema: { name: req.task, schema: req.schema, strict: true },
              },
            }
          : this.responseFormat === 'json_object'
            ? { response_format: { type: 'json_object' } }
            : {};
      let res: Response;
      try {
        res = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({
            model: req.model,
            messages: [{ role: 'system', content: req.system }, ...req.messages],
            temperature: req.temperature,
            max_tokens: Math.max(req.maxTokens, THINKING_ROOM),
            ...format,
          }),
          signal: withTimeout(req.signal, this.timeoutMs),
        });
      } catch (err) {
        if (req.signal?.aborted) throw err;
        if (err instanceof Error && err.name === 'TimeoutError') {
          throw new ProviderError(
            `No answer within ${Math.round(this.timeoutMs / 1000)} s.`,
            false,
          );
        }
        throw new ProviderError(`Cannot reach ${this.baseUrl}.`, true);
      }
      if (res.status === 400 && this.responseFormat !== 'none') {
        const detail = await res.text();
        if (/response_format|json_schema|json_object/i.test(detail)) {
          this.responseFormat = this.responseFormat === 'json_schema' ? 'json_object' : 'none';
          continue;
        }
        throw new ProviderError(`Request rejected: ${detail.slice(0, 300)}`, true);
      }
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        throw new ProviderError(
          `${res.status} from ${this.baseUrl}: ${(await res.text()).slice(0, 200)}`,
          true,
        );
      }
      if (!res.ok)
        throw new ProviderError(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`, false);
      const json = (await res.json()) as {
        choices?: { message?: { content?: string }; finish_reason?: string }[];
        model?: string;
      };
      const choice = json.choices?.[0];
      if (choice?.finish_reason === 'length' && !choice.message?.content?.trim()) {
        throw new ProviderError(
          `The answer was cut off at ${Math.max(req.maxTokens, THINKING_ROOM)} tokens before it began; a model that thinks first may need more.`,
          false,
        );
      }
      return {
        text: choice?.message?.content ?? '',
        model: `openai:${json.model ?? req.model}`,
        latencyMs: Math.round(performance.now() - started),
      };
    }
  }
}
