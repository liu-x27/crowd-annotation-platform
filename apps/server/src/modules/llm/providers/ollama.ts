import type { ProviderInfo } from '@crowd/shared';
import {
  type Completion,
  type CompletionRequest,
  type LlmProvider,
  ProviderError,
  withTimeout,
} from '../types';

interface OllamaTag {
  name: string;
  size?: number;
  details?: { parameter_size?: string; quantization_level?: string };
}

/**
 * Local models through Ollama's /api/chat. Answers are grammar-constrained to the JSON
 * schema (`format`), so a label outside the label set cannot be produced at all. Models
 * that think (qwen3 and similar) are asked not to: on a one-word label, thinking costs
 * tens of times the tokens and does not change the answer format.
 */
export class OllamaProvider implements LlmProvider {
  readonly id = 'ollama' as const;
  private readonly capabilities = new Map<string, Promise<string[]>>();

  constructor(
    private readonly baseUrl: string,
    readonly defaultModel: string,
    private readonly timeoutMs: number,
  ) {}

  async describe(): Promise<ProviderInfo> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { models = [] } = (await res.json()) as { models?: OllamaTag[] };
      return {
        id: this.id,
        available: true,
        reason: null,
        defaultModel: this.defaultModel,
        models: models.map((m) => ({
          name: m.name,
          detail:
            [m.details?.parameter_size, m.size ? `${(m.size / 1e9).toFixed(1)} GB` : null]
              .filter(Boolean)
              .join(' · ') || null,
        })),
      };
    } catch (err) {
      return {
        id: this.id,
        available: false,
        reason: `Ollama is not reachable at ${this.baseUrl} (${err instanceof Error ? err.message : err}).`,
        defaultModel: this.defaultModel,
        models: [],
      };
    }
  }

  private modelCapabilities(model: string): Promise<string[]> {
    let pending = this.capabilities.get(model);
    if (!pending) {
      pending = fetch(`${this.baseUrl}/api/show`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model }),
        signal: AbortSignal.timeout(5000),
      })
        .then(async (r) =>
          r.ok ? (((await r.json()) as { capabilities?: string[] }).capabilities ?? []) : [],
        )
        .catch(() => []);
      this.capabilities.set(model, pending);
    }
    return pending;
  }

  async complete(req: CompletionRequest): Promise<Completion> {
    const started = performance.now();
    const caps = await this.modelCapabilities(req.model);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: req.model,
          stream: false,
          messages: [{ role: 'system', content: req.system }, ...req.messages],
          format: req.schema,
          options: { temperature: req.temperature, num_predict: req.maxTokens },
          keep_alive: '10m',
          ...(caps.includes('thinking') ? { think: false } : {}),
        }),
        signal: withTimeout(req.signal, this.timeoutMs),
      });
    } catch (err) {
      if (req.signal?.aborted) throw err;
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new ProviderError(
          `Ollama did not answer within ${Math.round(this.timeoutMs / 1000)} s.`,
          false,
        );
      }
      throw new ProviderError(`Cannot reach Ollama at ${this.baseUrl}. Is it running?`, true);
    }
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      if (res.status === 404) {
        throw new ProviderError(
          `Ollama has no model "${req.model}". Pull it with: ollama pull ${req.model}`,
          true,
        );
      }
      throw new ProviderError(`Ollama returned ${res.status}: ${detail}`, res.status === 400);
    }
    const json = (await res.json()) as { message?: { content?: string } };
    return {
      text: json.message?.content ?? '',
      model: `ollama:${req.model}`,
      latencyMs: Math.round(performance.now() - started),
    };
  }
}
