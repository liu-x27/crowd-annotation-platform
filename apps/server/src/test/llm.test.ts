import type { JobView, PreviewRow } from '@crowd/shared';
import { labelsFromNames } from '@crowd/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { annotations } from '../db/schema';
import { extractJson, parseClassification, parseNer } from '../modules/llm/parse';
import { type Harness, harness } from './harness';

describe('parsing model output', () => {
  it('finds the JSON object behind reasoning, fences and prose', () => {
    expect(extractJson('<think>maybe {"label": "x"}?</think>{"label": "sports"}')).toEqual({
      label: 'sports',
    });
    expect(extractJson('```json\n{"label": "财经"}\n```')).toEqual({ label: '财经' });
    expect(
      extractJson(
        'Sure! Here it is: {"entities": [{"text": "a}b", "label": "PER"}]} hope that helps',
      ),
    ).toEqual({
      entities: [{ text: 'a}b', label: 'PER' }],
    });
    expect(extractJson('no json here')).toBeUndefined();
  });

  it('accepts exactly one allowed label and nothing else', () => {
    const labels = ['sports', 'finance'];
    expect(parseClassification('{"label": "finance"}', labels)).toEqual({
      ok: true,
      label: 'finance',
    });
    expect(parseClassification('{"label": "Finance"}', labels)).toEqual({
      ok: true,
      label: 'finance',
    });
    expect(parseClassification('sports', labels)).toEqual({ ok: true, label: 'sports' });
    // v1 would have taken "sports" here because it appears first; this is an error.
    expect(parseClassification("Not sports — it's about finance.", labels).ok).toBe(false);
    expect(parseClassification('{"label": "weather"}', labels).ok).toBe(false);
    expect(parseClassification('', labels).ok).toBe(false);
  });

  it('places NER guesses by surface text and reports what it could not place', () => {
    const r = parseNer(
      '{"entities": [{"text": "张伟", "label": "PER"}, {"text": "火星", "label": "LOC"}]}',
      '张伟在北京',
      ['PER', 'LOC'],
    );
    expect(r).toMatchObject({
      ok: true,
      spans: [{ start: 0, end: 2, label: 'PER', text: '张伟' }],
    });
    expect(r.ok && r.unaligned).toEqual([{ text: '火星', label: 'LOC' }]);
  });
});

let h: Harness;
beforeAll(async () => {
  h = await harness();
});
afterAll(async () => h.close());

async function runJob(projectId: number, body: Record<string, unknown>): Promise<JobView> {
  const res = await h.admin.post<JobView>(`/api/projects/${projectId}/llm/jobs`, body);
  expect(res.status).toBe(202);
  await h.deps.jobs.idle();
  return (await h.admin.get<JobView>(`/api/jobs/${res.body.id}`)).body;
}

describe('pre-labelling jobs', () => {
  it('drafts every item with a well-behaved model', async () => {
    const p = await h.project(
      { name: 'drafts', labels: ['sports', 'finance'], settings: { llm: { provider: 'mock' } } },
      [
        'The sports section led with the derby.',
        'finance ministers met on Tuesday.',
        'Something else entirely.',
      ],
    );
    const job = await runJob(p.id, { scope: 'missing' });
    expect(job.status).toBe('succeeded');
    expect(job.result).toMatchObject({ processed: 3, ok: 3, errors: 0 });
    const drafts = await h.deps.db
      .select()
      .from(annotations)
      .where(and(eq(annotations.projectId, p.id), eq(annotations.source, 'llm')));
    expect(drafts).toHaveLength(3);
    expect(
      drafts.every((d) => d.status === 'submitted' && d.rawOutput && d.model === 'mock:mock'),
    ).toBe(true);

    // Nothing left to do for "missing".
    const again = await runJob(p.id, { scope: 'missing' });
    expect(again.result).toMatchObject({ processed: 0 });
  });

  it('records failed calls as errors — never as a label', async () => {
    const texts = Array.from({ length: 60 }, (_, i) => `item ${i} about nothing in particular`);
    const p = await h.project(
      {
        name: 'flaky',
        labels: ['sports', 'finance'],
        settings: { llm: { provider: 'mock', model: 'mock-flaky' } },
      },
      texts,
    );
    const job = await runJob(p.id, { scope: 'missing' });
    expect(job.status).toBe('succeeded');
    const drafts = await h.deps.db
      .select()
      .from(annotations)
      .where(and(eq(annotations.projectId, p.id), eq(annotations.source, 'llm')));
    const errors = drafts.filter((d) => d.status === 'error');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((d) => d.label === null && d.error)).toBe(true);
    expect(job.result).toMatchObject({ processed: 60, errors: errors.length });

    // Retrying only the errors leaves the good drafts alone.
    const before = new Map(
      drafts.filter((d) => d.status === 'submitted').map((d) => [d.id, d.updatedAt.getTime()]),
    );
    const retry = await runJob(p.id, { scope: 'errors', model: 'mock' });
    expect(retry.result).toMatchObject({ processed: errors.length, errors: 0 });
    const after = await h.deps.db
      .select()
      .from(annotations)
      .where(and(eq(annotations.projectId, p.id), eq(annotations.source, 'llm')));
    for (const d of after)
      if (before.has(d.id)) expect(d.updatedAt.getTime()).toBe(before.get(d.id));
  });

  it('stops at the first fatal error instead of failing every item', async () => {
    const p = await h.project(
      { name: 'down', settings: { llm: { provider: 'mock', model: 'mock-down' } } },
      ['a', 'b', 'c'],
    );
    const job = await runJob(p.id, { scope: 'missing' });
    expect(job.status).toBe('failed');
    expect(job.error).toMatch(/down/);
    const drafts = await h.deps.db
      .select()
      .from(annotations)
      .where(and(eq(annotations.projectId, p.id), eq(annotations.source, 'llm')));
    expect(drafts).toHaveLength(0);
  });

  it('refuses a second concurrent job on the same project', async () => {
    const p = await h.project({ name: 'dup', settings: { llm: { provider: 'mock' } } }, ['a', 'b']);
    const first = await h.admin.post(`/api/projects/${p.id}/llm/jobs`, { scope: 'all' });
    const second = await h.admin.post(`/api/projects/${p.id}/llm/jobs`, { scope: 'all' });
    expect([first.status, second.status]).toEqual([202, 409]);
    await h.deps.jobs.idle();
  });

  it('drafts NER items and keeps unplaceable entities out of the spans', async () => {
    const p = await h.project(
      {
        name: 'ner-drafts',
        type: 'ner',
        labels: labelsFromNames(['PER', 'LOC']),
        settings: { llm: { provider: 'mock' } },
      },
      ['张伟和李娜在北京见面', '没有实体的句子'],
    );
    const job = await runJob(p.id, { scope: 'missing' });
    expect(job.status).toBe('succeeded');
    const detail = await h.admin.get(`/api/projects/${p.id}/items?llm=ok`);
    expect(detail.body.total).toBe(2);
    const first = await h.admin.get(`/api/projects/${p.id}/items/${detail.body.rows[0].id}`);
    const draft = first.body.annotations.find((a: { source: string }) => a.source === 'llm');
    expect(draft.spans.map((s: { text: string }) => s.text)).toEqual(['张伟', '李娜', '北京']);
  });
});

describe('preview', () => {
  it('shows the full exchange without saving anything', async () => {
    const p = await h.project(
      { name: 'preview', labels: ['sports', 'finance'], settings: { llm: { provider: 'mock' } } },
      ['sports today'],
    );
    const res = await h.admin.post<PreviewRow[]>(`/api/projects/${p.id}/llm/preview`, {
      text: 'finance news',
    });
    expect(res.status).toBe(200);
    expect(res.body[0]!.parsed).toEqual({ label: 'finance', spans: null });
    expect(res.body[0]!.messages[0]!.role).toBe('system');
    expect(res.body[0]!.messages[0]!.content).toContain('finance');
    const drafts = await h.deps.db
      .select()
      .from(annotations)
      .where(eq(annotations.projectId, p.id));
    expect(drafts).toHaveLength(0);
  });

  it('never shows an item its own answer as a worked example', async () => {
    const p = await h.project({
      name: 'leak',
      labels: ['sports', 'finance'],
      settings: { llm: { provider: 'mock', fewShot: 4 } },
    });
    await h.admin.post(`/api/projects/${p.id}/items/batch`, {
      items: [
        { text: 'derby report', label: 'sports' },
        { text: 'bond yields', label: 'finance' },
      ],
      finalizeImported: true,
    });
    const list = await h.admin.get(`/api/projects/${p.id}/items`);
    const target = list.body.rows[0];
    const res = await h.admin.post<PreviewRow[]>(`/api/projects/${p.id}/llm/preview`, {
      itemIds: [target.id],
    });
    const shown = res.body[0]!.messages.filter((m) => m.role === 'user').map((m) => m.content);
    expect(shown.filter((t) => t === target.text)).toHaveLength(1); // only as the question itself
  });
});
