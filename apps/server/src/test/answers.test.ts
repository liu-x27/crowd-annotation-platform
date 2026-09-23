import {
  type Answer,
  answerKey,
  canonicalSpans,
  labelsFromNames,
  type QueueView,
  type ReviewQueue,
  type Span,
} from '@crowd/shared';
import { eq, type SQL, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rows } from '../db/client';
import { annotations, items } from '../db/schema';
import { answerSql } from '../lib/answers';
import { type Harness, harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await harness();
});
afterAll(async () => h.close());

async function next(c: { get: (p: string) => Promise<{ body: QueueView }> }, projectId: number) {
  return (await c.get(`/api/projects/${projectId}/queue`)).body.claim!;
}

/** `answerSql` over literal rows, in the order given. */
async function sqlKeys(answers: { label: string | null; spans: unknown }[]): Promise<string[]> {
  const values: SQL[] = answers.map(
    (a, i) =>
      sql`(${i}::int, ${a.label}::text, ${a.spans == null ? null : JSON.stringify(a.spans)}::jsonb)`,
  );
  const found = await rows<{ key: string }>(
    h.deps.db,
    sql`select ${answerSql('x')} as key from (values ${sql.join(values, sql`, `)}) as x(n, label, spans) order by x.n`,
  );
  return found.map((r) => r.key);
}

const shuffled = <T>(xs: readonly T[], seed: number): T[] => {
  const out = [...xs];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
};

// Span sets that are the same or differ in every way that matters: order, a label, an
// offset, a missing span, and the derived `text` that must never reach storage.
const base: Span[] = [
  { start: 0, end: 2, label: 'PER' },
  { start: 3, end: 5, label: 'LOC' },
  { start: 7, end: 9, label: 'ORG' },
];
const nerAnswers: Answer[] = [
  { label: null, spans: base },
  { label: null, spans: shuffled(base, 1) },
  { label: null, spans: shuffled(base, 2).map((s) => ({ ...s, text: 'xx' })) },
  { label: null, spans: base.map((s, i) => (i === 1 ? { ...s, label: 'ORG' } : s)) },
  { label: null, spans: base.map((s, i) => (i === 2 ? { ...s, end: 10 } : s)) },
  { label: null, spans: base.slice(0, 2) },
  { label: null, spans: [] },
  { label: null, spans: [] },
];

describe('the SQL and JS definitions of a same answer', () => {
  it('agree on every pair of NER answers, once spans are stored canonically', async () => {
    const keys = await sqlKeys(
      nerAnswers.map((a) => ({ label: null, spans: canonicalSpans(a.spans ?? []) })),
    );
    for (let i = 0; i < nerAnswers.length; i++) {
      for (let j = 0; j < nerAnswers.length; j++) {
        const js = answerKey('ner', nerAnswers[i]!) === answerKey('ner', nerAnswers[j]!);
        expect([i, j, keys[i] === keys[j]]).toEqual([i, j, js]);
      }
    }
  });

  it('disagree when spans are stored as they came — which is why every write canonicalises', async () => {
    const keys = await sqlKeys(
      nerAnswers.slice(0, 3).map((a) => ({ label: null, spans: a.spans })),
    );
    // All three are the same answer by answerKey, yet SQL sees three different ones.
    expect(new Set(nerAnswers.slice(0, 3).map((a) => answerKey('ner', a))).size).toBe(1);
    expect(new Set(keys).size).toBe(3);
  });

  it('agree on classification answers', async () => {
    const labels = ['pos', 'neg', 'pos', 'neutral'];
    const keys = await sqlKeys(labels.map((label) => ({ label, spans: null })));
    for (let i = 0; i < labels.length; i++) {
      for (let j = 0; j < labels.length; j++) {
        expect(keys[i] === keys[j]).toBe(labels[i] === labels[j]);
      }
    }
  });
});

describe('every path that writes spans stores them canonically', () => {
  const text = '张伟在北京工作，李娜去上海了';
  const unsorted = [
    { start: 11, end: 13, label: 'LOC' },
    { start: 0, end: 2, label: 'PER' },
    { start: 3, end: 5, label: 'LOC' },
  ];
  const canonical = canonicalSpans(unsorted);

  it('submit, import, and consensus', async () => {
    const p = await h.project({ type: 'ner', labels: labelsFromNames(['PER', 'LOC']) }, [text]);
    const ann = await h.user('canon-ann');
    const claim = await next(ann, p.id);
    await ann.post(`/api/projects/${p.id}/annotations/${claim.annotationId}/submit`, {
      spans: unsorted,
    });
    const [stored] = await h.deps.db
      .select()
      .from(annotations)
      .where(eq(annotations.id, claim.annotationId));
    expect(stored!.spans).toEqual(canonical);
    const [consensus] = await h.deps.db.select().from(items).where(eq(items.id, claim.item.id));
    expect(consensus!.finalSpans).toEqual(canonical);

    await h.admin.post(`/api/projects/${p.id}/items/batch`, {
      items: [{ text: `${text}!`, spans: unsorted }],
      finalizeImported: true,
    });
    const imported = await rows<{ final_spans: Span[] }>(
      h.deps.db,
      sql`select final_spans from items where project_id = ${p.id} and seq = 2`,
    );
    expect(imported[0]!.final_spans).toEqual(canonical);
  });

  it('two annotators marking the same entities in a different order agree, and bulk review keeps it', async () => {
    const p = await h.project(
      {
        type: 'ner',
        labels: labelsFromNames(['PER', 'LOC']),
        settings: { redundancy: 2, autoFinalize: 'never' },
      },
      [text],
    );
    const [a, b] = await Promise.all([h.user('order-a'), h.user('order-b')]);
    const [ca, cb] = [await next(a, p.id), await next(b, p.id)];
    await a.post(`/api/projects/${p.id}/annotations/${ca.annotationId}/submit`, {
      spans: unsorted,
    });
    await b.post(`/api/projects/${p.id}/annotations/${cb.annotationId}/submit`, {
      spans: [...unsorted].reverse(),
    });
    const queue = await h.admin.get<ReviewQueue>(`/api/projects/${p.id}/review`);
    expect(queue.body.counts.disagreement).toBe(0); // the SQL definition
    expect(queue.body.entries[0]!.disagreement).toBe(false); // the JS one
    expect(queue.body.entries[0]!.majority).toMatchObject({ votes: 2, total: 2 });

    // The majority carries each span's text for display; storage must not.
    const bulk = await h.admin.post(`/api/projects/${p.id}/review/bulk-finalize`, {
      strategy: 'unanimous',
    });
    expect(bulk.body).toEqual({ finalized: 1, skipped: 0 });
    const [item] = await h.deps.db.select().from(items).where(eq(items.id, ca.item.id));
    expect(item!.finalSpans).toEqual(canonical);
  });
});

describe('finalising', () => {
  async function classified(name: string, answers: string[][], flagged: number[] = []) {
    const p = await h.project(
      // Consensus off, so every item is left for the bulk run to decide.
      {
        name,
        settings: { redundancy: 3, autoFinalize: 'never' },
        labels: ['pos', 'neg', 'neutral'],
      },
      answers.map((_, i) => `${name} item ${i + 1}`),
    );
    const people = await Promise.all([0, 1, 2].map((k) => h.user(`${name}-${k}`)));
    for (let item = 0; item < answers.length; item++) {
      for (let k = 0; k < 3; k++) {
        const claim = await next(people[k]!, p.id);
        await people[k]!.post(`/api/projects/${p.id}/annotations/${claim.annotationId}/submit`, {
          label: answers[item]![k],
          flagged: flagged.includes(item) && k === 0,
        });
      }
    }
    const ids = await rows<{ id: number }>(
      h.deps.db,
      sql`select id from items where project_id = ${p.id} order by seq`,
    );
    return { p, ids: ids.map((r) => r.id) };
  }

  const finals = async (projectId: number) =>
    (
      await rows<{ final_label: string | null; final_source: string | null }>(
        h.deps.db,
        sql`select final_label, final_source from items where project_id = ${projectId} order by seq`,
      )
    ).map((r) => (r.final_label ? `${r.final_label}:${r.final_source}` : null));

  it('bulk "majority" takes a strict majority, and leaves ties and flags to a person', async () => {
    const { p } = await classified(
      'bulk-maj',
      [
        ['pos', 'pos', 'neg'], // 2 of 3
        ['pos', 'neg', 'neutral'], // three-way tie
        ['neg', 'neg', 'neg'], // unanimous, but flagged
      ],
      [2],
    );
    const res = await h.admin.post(`/api/projects/${p.id}/review/bulk-finalize`, {
      strategy: 'majority',
    });
    expect(res.body).toEqual({ finalized: 1, skipped: 2 });
    expect(await finals(p.id)).toEqual(['pos:review', null, null]);
  });

  it('bulk "unanimous" takes only unanimous items', async () => {
    const { p } = await classified('bulk-una', [
      ['pos', 'pos', 'neg'],
      ['neg', 'neg', 'neg'],
    ]);
    expect(await finals(p.id)).toEqual([null, null]);
    const res = await h.admin.post(`/api/projects/${p.id}/review/bulk-finalize`, {
      strategy: 'unanimous',
    });
    expect(res.body).toEqual({ finalized: 1, skipped: 1 });
    expect(await finals(p.id)).toEqual([null, 'neg:review']);
  });

  it('never overwrites an item someone already finalised', async () => {
    const { p, ids } = await classified('bulk-keep', [['pos', 'pos', 'neg']]);
    await h.admin.post(`/api/projects/${p.id}/items/${ids[0]}/finalize`, { label: 'neutral' });

    const bulk = await h.admin.post(`/api/projects/${p.id}/review/bulk-finalize`, {
      strategy: 'majority',
      itemIds: ids,
    });
    expect(bulk.body).toEqual({ finalized: 0, skipped: 1 });

    const again = await h.admin.post(`/api/projects/${p.id}/items/${ids[0]}/finalize`, {
      label: 'pos',
    });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('item_finalized');
    expect(await finals(p.id)).toEqual(['neutral:review']);
  });
});
