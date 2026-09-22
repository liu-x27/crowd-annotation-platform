import type {
  AgreementReport,
  DraftQuality,
  Overview,
  QueueView,
  SubmitResult,
} from '@crowd/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await harness();
});
afterAll(async () => h.close());

describe('project statistics', () => {
  it('reports agreement, draft quality and the blind-audit split', async () => {
    const texts = Array.from({ length: 40 }, (_, i) =>
      i % 2 ? `pos review ${i}` : `neg review ${i}`,
    );
    const p = await h.project(
      {
        name: 'metrics',
        labels: ['pos', 'neg'],
        settings: { redundancy: 2, blindRate: 0.5, llm: { provider: 'mock' } },
      },
      texts,
    );
    await h.admin.post(`/api/projects/${p.id}/llm/jobs`, { scope: 'all' });
    await h.deps.jobs.idle();

    // Two annotators: A copies the keyword, B disagrees on every fourth item.
    const a = await h.user('metric-a');
    const b = await h.user('metric-b');
    for (const [who, wrongEvery] of [
      [a, 0],
      [b, 4],
    ] as const) {
      let q = (await who.get<QueueView>(`/api/projects/${p.id}/queue`)).body;
      let n = 0;
      while (q.claim) {
        const truth = q.claim.item.text.startsWith('pos') ? 'pos' : 'neg';
        const label =
          wrongEvery && ++n % wrongEvery === 0 ? (truth === 'pos' ? 'neg' : 'pos') : truth;
        const res = await who.post<SubmitResult>(
          `/api/projects/${p.id}/annotations/${q.claim.annotationId}/submit`,
          {
            label,
            durationMs: 1000 + n,
          },
        );
        q = res.body.next;
      }
    }

    const ov = await h.admin.get<Overview>(`/api/projects/${p.id}/stats/overview?tz=Asia/Shanghai`);
    expect(ov.status).toBe(200);
    expect(ov.body.counts.items).toBe(40);
    expect(ov.body.counts.finalized).toBe(30);
    expect(ov.body.counts.needsReview).toBe(10);
    expect(ov.body.annotations.human).toBe(80);
    expect(ov.body.annotators).toHaveLength(2);
    expect(ov.body.throughput.at(-1)!.submitted).toBe(80);
    expect(ov.body.labels.map((l) => l.label)).toEqual(['pos', 'neg']);

    const ag = await h.admin.get<AgreementReport>(`/api/projects/${p.id}/stats/agreement`);
    expect(ag.body.itemsCompared).toBe(40);
    expect(ag.body.observed).toBeCloseTo(0.75, 5);
    expect(ag.body.pairs[0]!.kappa).toBeCloseTo(0.5, 1);
    expect(ag.body.alpha).not.toBeNull();

    const dq = await h.admin.get<DraftQuality>(
      `/api/projects/${p.id}/stats/drafts?reference=human`,
    );
    expect(dq.body.compared).toBe(80);
    expect(dq.body.accuracy!).toBeGreaterThan(0.8);
    expect(dq.body.confusion!.labels).toEqual(['pos', 'neg']);
    const { shown, hidden } = dq.body.anchoring;
    expect(shown.n + hidden.n).toBe(80);
    expect(shown.n).toBeGreaterThan(0);
    expect(hidden.n).toBeGreaterThan(0);

    const me = await a.get(`/api/me/stats?tz=America/New_York`);
    expect(me.body).toMatchObject({ submitted: 40, today: 40 });
    expect(me.body.agreeWithFinal).toBeGreaterThan(0.9);
  });

  it('lists jobs and streams nothing to annotators they should not see', async () => {
    const jobs = await h.admin.get('/api/jobs');
    expect(Array.isArray(jobs.body)).toBe(true);
    const ann = await h.user('no-jobs');
    expect((await ann.get('/api/jobs')).status).toBe(403);
    expect((await ann.get('/api/llm/providers')).status).toBe(403);
    const providers = await h.admin.get('/api/llm/providers');
    expect(providers.body.map((p: { id: string }) => p.id)).toEqual([
      'ollama',
      'anthropic',
      'openai',
      'mock',
    ]);
  });
});
