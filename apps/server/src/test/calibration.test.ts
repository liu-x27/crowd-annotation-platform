import type { CalibrationReport, QueueView, ReviewQueue, SubmitResult } from '@crowd/shared';
import { classicalMean, ppiMean, wilsonInterval } from '@crowd/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rows } from '../db/client';
import { type Client, type Harness, harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await harness();
});
afterAll(async () => h.close());

const texts = (n: number, prefix: string) =>
  Array.from({ length: n }, (_, i) => `${prefix} sentence ${i + 1}`);

async function queue(c: Client, projectId: number): Promise<QueueView> {
  return (await c.get<QueueView>(`/api/projects/${projectId}/queue`)).body;
}

/** Drafts for every item: 'pos' on even seq, 'neg' on odd. */
async function draftAll(projectId: number) {
  await h.deps.db.execute(sql`
    insert into annotations (project_id, item_id, source, status, label, model)
    select project_id, id, 'llm', 'submitted', case when seq % 2 = 0 then 'pos' else 'neg' end, 'test'
    from items where project_id = ${projectId}`);
}

const calibrationItems = async (projectId: number) =>
  (
    await rows<{ id: number; seq: number }>(
      h.deps.db,
      sql`select id, seq from items where project_id = ${projectId} and calibration order by seq`,
    )
  ).map((r) => r.id);

describe('drawing a calibration set', () => {
  it('draws untouched items by hash, the same ones every time, once', async () => {
    const p = await h.project({ name: 'draw' }, texts(30, 'draw'));
    const ann = await h.user('draw-ann');
    const first = await queue(ann, p.id); // claims item 1 before the draw
    const drawn = await h.admin.post(`/api/projects/${p.id}/calibration`, { size: 10 });
    expect(drawn.status).toBe(201);
    expect(drawn.body).toEqual({ drawn: 10 });
    const ids = await calibrationItems(p.id);
    expect(ids).toHaveLength(10);
    expect(ids).not.toContain(first.claim!.item.id);

    const again = await h.admin.post(`/api/projects/${p.id}/calibration`, { size: 10 });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('calibration_exists');

    const cleared = await h.admin.del(`/api/projects/${p.id}/calibration`);
    expect(cleared.body).toEqual({ cleared: 10 });
    await h.admin.post(`/api/projects/${p.id}/calibration`, { size: 10 });
    expect(await calibrationItems(p.id)).toEqual(ids);
  });

  it('is for managers only', async () => {
    const p = await h.project({ name: 'draw-perm' }, texts(3, 'perm'));
    const reviewer = await h.user('draw-reviewer', 'reviewer');
    expect((await reviewer.post(`/api/projects/${p.id}/calibration`, { size: 1 })).status).toBe(
      403,
    );
    expect((await reviewer.get(`/api/projects/${p.id}/calibration`)).status).toBe(200);
  });
});

describe('serving a calibration set', () => {
  it('serves it first, never with the draft, and to three people at redundancy 1', async () => {
    const p = await h.project(
      { name: 'serve', settings: { redundancy: 1, autoFinalize: 'never' } },
      texts(12, 'serve'),
    );
    await draftAll(p.id);
    await h.admin.post(`/api/projects/${p.id}/calibration`, { size: 4 });
    const calibration = new Set(await calibrationItems(p.id));
    const people = await Promise.all(['a', 'b', 'c', 'd'].map((x) => h.user(`serve-${x}`)));

    // Each of the first three works through the queue; their first four items are the set.
    const served: number[][] = [];
    for (const person of people.slice(0, 3)) {
      const mine: number[] = [];
      let claim = (await queue(person, p.id)).claim;
      while (claim) {
        if (calibration.has(claim.item.id)) expect(claim.draft).toBeNull();
        else expect(claim.draft).not.toBeNull();
        mine.push(claim.item.id);
        const res = await person.post<SubmitResult>(
          `/api/projects/${p.id}/annotations/${claim.annotationId}/submit`,
          { label: 'pos' },
        );
        claim = res.body.next.claim;
      }
      served.push(mine);
    }
    const [first, ...rest] = served;
    expect(new Set(first!.slice(0, 4))).toEqual(calibration);
    expect(first).toHaveLength(12); // the first person gets every item
    for (const mine of rest) expect(new Set(mine)).toEqual(calibration);

    // Three answers each, so a fourth person is served nothing.
    expect((await queue(people[3]!, p.id)).claim).toBeNull();
    const shown = await rows<{ n: number }>(
      h.deps.db,
      sql`select count(*)::int as n from annotations a join items i on i.id = a.item_id
          where i.project_id = ${p.id} and i.calibration and a.source = 'human' and a.draft_shown`,
    );
    expect(shown[0]!.n).toBe(0);
  });

  it('finalises a calibration item by consensus only once three agree, and reviews it at three', async () => {
    const p = await h.project({ name: 'consensus', settings: { redundancy: 1 } }, texts(3, 'con'));
    await h.admin.post(`/api/projects/${p.id}/calibration`, { size: 1 });
    const [itemId] = await calibrationItems(p.id);
    const people = await Promise.all(['a', 'b', 'c'].map((x) => h.user(`con-${x}`)));
    const finalized: boolean[] = [];
    for (const [k, person] of people.entries()) {
      const q = await queue(person, p.id);
      expect(q.claim!.item.id).toBe(itemId);
      const res = await person.post<SubmitResult>(
        `/api/projects/${p.id}/annotations/${q.claim!.annotationId}/submit`,
        { label: k === 2 ? 'neg' : 'pos' },
      );
      finalized.push(res.body.finalized);
      const review = await h.admin.get<ReviewQueue>(`/api/projects/${p.id}/review`);
      expect(review.body.entries.map((e) => e.item.id).includes(itemId!)).toBe(k === 2);
    }
    expect(finalized).toEqual([false, false, false]); // two pos and a neg: not unanimous
  });
});

describe('the calibration report', () => {
  it('measures the drafts against the blind answers', async () => {
    const p = await h.project(
      { name: 'report', settings: { redundancy: 1, autoFinalize: 'never' } },
      texts(20, 'report'),
    );
    await draftAll(p.id);
    await h.admin.post(`/api/projects/${p.id}/calibration`, { size: 6 });
    const calibration = await calibrationItems(p.id);
    const people = await Promise.all(['a', 'b', 'c'].map((x) => h.user(`report-${x}`)));
    // a and b answer 'pos' everywhere; c answers 'neg' on calibration items.
    for (const [k, person] of people.entries()) {
      let claim = (await queue(person, p.id)).claim;
      while (claim) {
        const label = k === 2 && calibration.includes(claim.item.id) ? 'neg' : 'pos';
        const res = await person.post<SubmitResult>(
          `/api/projects/${p.id}/annotations/${claim.annotationId}/submit`,
          { label },
        );
        claim = res.body.next.claim;
      }
    }

    const { body: report } = await h.admin.get<CalibrationReport>(
      `/api/projects/${p.id}/calibration?epsilon=0.1`,
    );
    expect(report).toMatchObject({ size: 6, complete: 6, referenced: 6, ties: 0 });

    const seqs = await rows<{ id: number; seq: number }>(
      h.deps.db,
      sql`select id, seq from items where project_id = ${p.id} order by seq`,
    );
    const draftOf = new Map(seqs.map((r) => [r.id, r.seq % 2 === 0 ? 'pos' : 'neg']));
    const correct = calibration.filter((id) => draftOf.get(id) === 'pos').length;
    expect(report.draftAccuracy).toEqual({
      correct,
      n: 6,
      interval: wilsonInterval(correct, 6),
    });

    // Six items each is under the test's minimum of 30 per annotator.
    expect(report.altTest).toMatchObject({ epsilon: 0.1, winningRate: null, passed: false });
    expect(report.altTest!.skipped.map((s) => s.instances)).toEqual([6, 6, 6]);

    const others = seqs.filter((r) => !calibration.includes(r.id)).map((r) => draftOf.get(r.id)!);
    const yhat = calibration.map((id) => (draftOf.get(id) === 'pos' ? 1 : 0));
    const unl = others.map((l) => (l === 'pos' ? 1 : 0));
    const pos = report.distribution!.labels.find((l) => l.label === 'pos')!;
    expect(report.distribution).toMatchObject({ n: 6, N: 14 });
    expect(pos.calibration).toEqual(classicalMean([1, 1, 1, 1, 1, 1]));
    expect(pos.ppi).toEqual(ppiMean([1, 1, 1, 1, 1, 1], yhat, unl));
    expect(pos.drafts).toBeCloseTo([...yhat, ...unl].filter(Boolean).length / 20, 12);
  });

  it('says so for NER projects, and is empty without a set', async () => {
    const ner = await h.project({ name: 'report-ner', type: 'ner', labels: ['PER'] }, ['x y']);
    await h.admin.post(`/api/projects/${ner.id}/calibration`, { size: 1 });
    expect((await h.admin.get(`/api/projects/${ner.id}/calibration`)).body).toMatchObject({
      size: 1,
      supported: false,
      draftAccuracy: null,
    });
    const none = await h.project({ name: 'report-none' }, ['a']);
    expect((await h.admin.get(`/api/projects/${none.id}/calibration`)).body).toMatchObject({
      size: 0,
      distribution: null,
    });
  });
});
