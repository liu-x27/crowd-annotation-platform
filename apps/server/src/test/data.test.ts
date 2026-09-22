import type { ImportResult, QueueView } from '@crowd/shared';
import { labelsFromNames } from '@crowd/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await harness();
});
afterAll(async () => h.close());

describe('import', () => {
  it('numbers items consecutively across batches and skips duplicates', async () => {
    const p = await h.project({ name: 'imp' });
    const a = await h.admin.post<ImportResult>(`/api/projects/${p.id}/items/batch`, {
      // Duplicates are found after width and whitespace normalisation; case is kept, since
      // "GREAT" and "great" can deserve different labels.
      items: [{ text: 'one' }, { text: 'two' }, { text: ' one\t' }, { text: '   ' }],
    });
    expect(a.body).toMatchObject({
      inserted: 2,
      duplicates: 1,
      skipped: 1,
      firstSeq: 1,
      lastSeq: 2,
    });
    const b = await h.admin.post<ImportResult>(`/api/projects/${p.id}/items/batch`, {
      items: [{ text: 'three' }, { text: 'two' }],
    });
    expect(b.body).toMatchObject({ inserted: 1, duplicates: 1, firstSeq: 3, lastSeq: 3 });
  });

  it('keeps multi-line text intact', async () => {
    const p = await h.project({ name: 'multiline' });
    await h.admin.post(`/api/projects/${p.id}/items/batch`, {
      items: [{ text: 'line one,\r\n"quoted", line two' }],
    });
    const list = await h.admin.get(`/api/projects/${p.id}/items`);
    expect(list.body.rows[0].text).toBe('line one,\n"quoted", line two');
  });

  it('handles labels outside the label set as told', async () => {
    const p = await h.project({ name: 'unknown', labels: ['pos', 'neg'] });
    const url = `/api/projects/${p.id}/items/batch`;
    const err = await h.admin.post(url, { items: [{ text: 'a', label: 'neutral' }] });
    expect(err.status).toBe(400);
    expect(err.body.error.details.labels).toEqual(['neutral']);

    const skip = await h.admin.post<ImportResult>(url, {
      items: [{ text: 'b', label: 'neutral' }],
      unknownLabels: 'skip',
    });
    expect(skip.body).toMatchObject({ inserted: 1, labeled: 0, labelsDropped: 1 });

    const add = await h.admin.post<ImportResult>(url, {
      items: [{ text: 'c', label: 'neutral' }],
      unknownLabels: 'add',
    });
    expect(add.body).toMatchObject({ inserted: 1, labeled: 1, addedLabels: ['neutral'] });
    const project = await h.admin.get(`/api/projects/${p.id}`);
    expect(project.body.labels.map((l: { name: string }) => l.name)).toEqual([
      'pos',
      'neg',
      'neutral',
    ]);
  });

  it('stores imported labels as their own source, final only when asked', async () => {
    const p = await h.project({ name: 'gold', labels: ['pos', 'neg'] });
    await h.admin.post(`/api/projects/${p.id}/items/batch`, {
      items: [
        { text: 'good', label: 'pos' },
        { text: 'bad', label: 'neg' },
      ],
      finalizeImported: true,
    });
    await h.admin.post(`/api/projects/${p.id}/items/batch`, {
      items: [{ text: 'meh', label: 'neg' }],
    });
    const list = await h.admin.get(`/api/projects/${p.id}/items`);
    const bySeq = new Map(list.body.rows.map((r: { seq: number }) => [r.seq, r]));
    expect(bySeq.get(1)).toMatchObject({
      state: 'finalized',
      final: { label: 'pos', source: 'import' },
      humanCount: 0,
    });
    expect(bySeq.get(3)).toMatchObject({
      state: 'unlabeled',
      imported: { label: 'neg' },
      final: null,
    });

    // An imported label is not a human one: the item still goes into the annotation queue.
    const ann = await h.user('gold-ann');
    const q = await ann.get<QueueView>(`/api/projects/${p.id}/queue`);
    expect(q.body.claim!.item.seq).toBe(3);
  });

  it('validates imported NER spans and drops bad ones with a warning', async () => {
    const p = await h.project({ name: 'ner-imp', type: 'ner', labels: labelsFromNames(['PER']) });
    const res = await h.admin.post<ImportResult>(`/api/projects/${p.id}/items/batch`, {
      items: [
        { text: '张伟来了', spans: [{ start: 0, end: 2, label: 'PER' }] },
        { text: '李娜', spans: [{ start: 1, end: 9, label: 'PER' }] },
      ],
    });
    expect(res.body).toMatchObject({ inserted: 2, labeled: 1 });
    expect(res.body.warnings[0]).toMatch(/row 2/);
  });
});

describe('listing', () => {
  it('filters by state, text, label and draft status, with totals', async () => {
    const p = await h.project({
      name: 'list',
      labels: ['pos', 'neg'],
      settings: { llm: { provider: 'mock' } },
    });
    await h.admin.post(`/api/projects/${p.id}/items/batch`, {
      items: [
        { text: 'apple pie', label: 'pos' },
        { text: 'apple crumble', label: 'neg' },
        { text: 'banana' },
      ],
      finalizeImported: true,
    });
    const url = (q: string) => `/api/projects/${p.id}/items?${q}`;
    expect((await h.admin.get(url('state=finalized'))).body.total).toBe(2);
    expect((await h.admin.get(url('state=unlabeled'))).body.total).toBe(1);
    expect((await h.admin.get(url('q=APPLE'))).body.total).toBe(2);
    expect((await h.admin.get(url('q=%25'))).body.total).toBe(0); // % is literal, not a wildcard
    expect((await h.admin.get(url('label=neg'))).body.total).toBe(1);
    expect((await h.admin.get(url('llm=missing'))).body.total).toBe(3);
    const paged = await h.admin.get(url('pageSize=2&page=2&sort=-seq'));
    expect(paged.body.rows.map((r: { seq: number }) => r.seq)).toEqual([1]);
  });
});

describe('export', () => {
  async function seeded() {
    const p = await h.project({
      name: 'export "quoted", name',
      labels: ['pos', 'neg'],
      settings: { llm: { provider: 'mock' } },
    });
    await h.admin.post(`/api/projects/${p.id}/items/batch`, {
      items: [{ text: 'gold, with comma', label: 'pos' }, { text: 'plain' }],
      finalizeImported: true,
    });
    const ann = await h.user(`exp-${p.id}`);
    const q = await ann.get<QueueView>(`/api/projects/${p.id}/queue`);
    await ann.post(`/api/projects/${p.id}/annotations/${q.body.claim!.annotationId}/submit`, {
      label: 'neg',
    });
    await h.admin.post(`/api/projects/${p.id}/llm/jobs`, { scope: 'all' });
    await h.deps.jobs.idle();
    return p;
  }

  it('exports final labels as JSONL, only finalised items by default', async () => {
    const p = await seeded();
    const res = await h.admin.get(`/api/projects/${p.id}/export?format=jsonl&labels=final`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain("filename*=UTF-8''");
    const lines = res.text
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => [l.label, l.source])).toEqual([
      ['pos', 'import'],
      ['neg', 'consensus'],
    ]);
  });

  it('keeps sources apart: human-only export has no model or imported labels', async () => {
    const p = await seeded();
    const human = await h.admin.get(
      `/api/projects/${p.id}/export?format=jsonl&labels=human&onlyFinalized=false`,
    );
    const rows = human.text
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      text: 'plain',
      label: 'neg',
      annotator: expect.stringMatching(/^exp-/),
    });

    const llm = await h.admin.get(
      `/api/projects/${p.id}/export?format=jsonl&labels=llm&onlyFinalized=false`,
    );
    expect(llm.text.trim().split('\n')).toHaveLength(2);
    const all = await h.admin.get(
      `/api/projects/${p.id}/export?format=jsonl&labels=all&onlyFinalized=false`,
    );
    const first = JSON.parse(all.text.split('\n')[0]!);
    expect(first).toHaveProperty('import.label', 'pos');
    expect(first).toHaveProperty('llm.model');
  });

  it('writes RFC-4180 CSV with a BOM', async () => {
    const p = await seeded();
    const res = await h.admin.get(`/api/projects/${p.id}/export?format=csv&labels=final`);
    expect(res.text.charCodeAt(0)).toBe(0xfeff);
    expect(res.text).toContain('"gold, with comma",pos,import');
  });

  it('writes character-level BIO for NER', async () => {
    const p = await h.project({ name: 'conll', type: 'ner', labels: labelsFromNames(['PER']) });
    await h.admin.post(`/api/projects/${p.id}/items/batch`, {
      items: [{ text: '张伟 来了', spans: [{ start: 0, end: 2, label: 'PER' }] }],
      finalizeImported: true,
    });
    const res = await h.admin.get(`/api/projects/${p.id}/export?format=conll&labels=final`);
    expect(res.text).toBe('张\tB-PER\n伟\tI-PER\n来\tO\n了\tO\n\n');
    const bad = await h.admin.get(`/api/projects/${p.id}/export?format=conll&labels=human`);
    expect(bad.status).toBe(400);
  });
});

describe('project settings', () => {
  it('renames a label everywhere it is used and refuses to drop one in use', async () => {
    const p = await h.project({ name: 'rename', labels: ['pos', 'neg'] });
    await h.admin.post(`/api/projects/${p.id}/items/batch`, {
      items: [{ text: 'x', label: 'pos' }],
      finalizeImported: true,
    });
    const drop = await h.admin.patch(`/api/projects/${p.id}`, { labels: labelsFromNames(['neg']) });
    expect(drop.status).toBe(409);
    expect(drop.body.error.code).toBe('label_in_use');

    const rename = await h.admin.patch(`/api/projects/${p.id}`, {
      labels: labelsFromNames(['positive', 'neg']),
      labelRenames: { pos: 'positive' },
    });
    expect(rename.status).toBe(200);
    const list = await h.admin.get(`/api/projects/${p.id}/items`);
    expect(list.body.rows[0]).toMatchObject({
      final: { label: 'positive' },
      imported: { label: 'positive' },
    });
  });
});
