import { fnv1a32, type ProviderInfo } from '@crowd/shared';
import { type Completion, type CompletionRequest, type LlmProvider, ProviderError } from '../types';

const GAZETTEER: Record<string, string[]> = {
  PER: ['Alice', 'Bob', 'Carol', '张伟', '李娜', '王芳', '刘洋'],
  LOC: ['Paris', 'London', 'Berlin', '北京', '上海', '杭州', '深圳'],
  ORG: ['Acme', 'Globex', '腾讯', '阿里巴巴', '清华大学'],
  TIME: ['2023年', '2024年', 'Monday', '昨天'],
};

/**
 * A deterministic stand-in model for tests, CI and machines without an LLM. It is not a
 * classifier worth using: it picks a label that appears in the text, else one by hash.
 *
 * - `mock`       well-behaved
 * - `mock-flaky` fails ~15% of calls and returns garbage ~10% of the time
 * - `mock-down`  every call fails fatally, like an unreachable server
 */
export class MockProvider implements LlmProvider {
  readonly id = 'mock' as const;
  readonly defaultModel = 'mock';

  async describe(): Promise<ProviderInfo> {
    return {
      id: this.id,
      available: true,
      reason: null,
      defaultModel: this.defaultModel,
      models: [
        { name: 'mock', detail: 'deterministic, for testing' },
        { name: 'mock-flaky', detail: 'fails some calls on purpose' },
      ],
    };
  }

  async complete(req: CompletionRequest): Promise<Completion> {
    if (req.signal?.aborted) throw req.signal.reason;
    const text = req.messages.at(-1)?.content ?? '';
    const h = fnv1a32(`${req.model}:${text}`);
    if (req.model === 'mock-down') throw new ProviderError('mock provider is down', true);
    if (req.model === 'mock-flaky') {
      if (h % 100 < 15) throw new ProviderError('mock: simulated timeout', false);
      if (h % 100 < 25) return this.reply(req, 'I think the answer is probably one of those.');
    }
    await new Promise((r) => setTimeout(r, 1));

    if (req.task === 'classification') {
      const labels = (req.schema as { properties: { label: { enum: string[] } } }).properties.label
        .enum;
      const lower = text.toLowerCase();
      const hit = labels.find((l) => lower.includes(l.toLowerCase()));
      return this.reply(req, JSON.stringify({ label: hit ?? labels[h % labels.length] }));
    }

    const labels = (
      req.schema as {
        properties: { entities: { items: { properties: { label: { enum: string[] } } } } };
      }
    ).properties.entities.items.properties.label.enum;
    const entities: { text: string; label: string }[] = [];
    for (const label of labels) {
      for (const name of GAZETTEER[label] ?? []) {
        let at = text.indexOf(name);
        while (at !== -1) {
          entities.push({ text: name, label });
          at = text.indexOf(name, at + name.length);
        }
      }
    }
    entities.sort((a, b) => text.indexOf(a.text) - text.indexOf(b.text));
    if (req.model === 'mock-flaky' && h % 7 === 0)
      entities.push({ text: 'Atlantis', label: labels[0]! });
    return this.reply(req, JSON.stringify({ entities }));
  }

  private reply(req: CompletionRequest, text: string): Completion {
    return { text, model: `mock:${req.model}`, latencyMs: 1 };
  }
}
