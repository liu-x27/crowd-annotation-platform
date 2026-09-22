import type { ClaimView, QueueView, ReviewQueue, SubmitResult } from '@crowd/shared';
import { labelsFromNames } from '@crowd/shared';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { annotations, items } from '../db/schema';
import { type Harness, harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await harness();
});
afterAll(async () => h.close());

const texts = (n: number, prefix = 'item') =>
  Array.from({ length: n }, (_, i) => `${prefix} number ${i + 1}`);

async function next(c: { get: (p: string) => Promise<{ body: QueueView }> }, projectId: number) {
  return (await c.get(`/api/projects/${projectId}/queue`)).body;
}

describe('claiming', () => {
  it('serves items in order and finalises on consensus with redundancy 1', async () => {
    const p = await h.project({ name: 'order' }, texts(3));
    const ann = await h.user('ann-order');
    const q = await next(ann, p.id);
    expect(q.claim!.item.seq).toBe(1);
    expect(q.remaining).toBe(2);

    const res = await ann.post<SubmitResult>(
      `/api/projects/${p.id}/annotations/${q.claim!.annotationId}/submit`,
      {
        label: 'pos',
        durationMs: 1200,
      },
    );
    expect(res.status).toBe(200);
    expect(res.body.finalized).toBe(true);
    expect(res.body.next.claim!.item.seq).toBe(2);

    const [item] = await h.deps.db
      .select()
      .from(items)
      .where(and(eq(items.projectId, p.id), eq(items.seq, 1)));
    expect(item).toMatchObject({ finalLabel: 'pos', finalSource: 'consensus', humanCount: 1 });
  });

  it('resumes the same claim instead of opening another', async () => {
    const p = await h.project({ name: 'resume' }, texts(3));
    const ann = await h.user('ann-resume');
    const a = await next(ann, p.id);
    const b = await next(ann, p.id);
    expect(b.claim!.annotationId).toBe(a.claim!.annotationId);
  });

  it('never hands the same item to two annotators, even when they ask at once', async () => {
    const p = await h.project({ name: 'race' }, texts(30));
    const people = await Promise.all(Array.from({ length: 6 }, (_, i) => h.user(`racer-${i}`)));
    const claims = await Promise.all(people.map((c) => next(c, p.id)));
    const ids = claims.map((q) => q.claim!.item.id);
    expect(new Set(ids).size).toBe(ids.length);

    // Keep going: every submit claims again, concurrently, until the pool is empty.
    const seen = new Set(ids);
    let current: (ClaimView | null)[] = claims.map((q) => q.claim!);
    while (current.some(Boolean)) {
      const results = await Promise.all(
        current.map((claim, i) =>
          claim
            ? people[i]!.post<SubmitResult>(
                `/api/projects/${p.id}/annotations/${claim.annotationId}/submit`,
                { label: 'neg' },
              )
            : null,
        ),
      );
      current = results.map((r) => r?.body.next.claim ?? null);
      for (const c of current) {
        if (!c) continue;
        expect(seen.has(c.item.id)).toBe(false);
        seen.add(c.item.id);
      }
    }
    expect(seen.size).toBe(30);
  });

  it('with redundancy 2, gives each item to two different people and no third', async () => {
    const p = await h.project({ name: 'redundant', settings: { redundancy: 2 } }, texts(2));
    const [a, b, c] = await Promise.all([h.user('red-a'), h.user('red-b'), h.user('red-c')]);
    const qa = await next(a, p.id);
    const qb = await next(b, p.id);
    const qc = await next(c, p.id);
    expect(qa.claim!.item.seq).toBe(1);
    expect(qb.claim!.item.seq).toBe(1);
    expect(qc.claim!.item.seq).toBe(2);

    // A and B disagree on item 1: it must wait for review, not auto-finalise.
    await a.post(`/api/projects/${p.id}/annotations/${qa.claim!.annotationId}/submit`, {
      label: 'pos',
    });
    const rb = await b.post<SubmitResult>(
      `/api/projects/${p.id}/annotations/${qb.claim!.annotationId}/submit`,
      { label: 'neg' },
    );
    expect(rb.body.finalized).toBe(false);

    const review = await h.admin.get<ReviewQueue>(
      `/api/projects/${p.id}/review?filter=disagreement`,
    );
    expect(review.body.total).toBe(1);
    const entry = review.body.entries[0]!;
    expect(entry.disagreement).toBe(true);
    expect(entry.majority!.tie).toBe(true);
    expect(entry.human.map((x) => x.label).sort()).toEqual(['neg', 'pos']);

    const fin = await h.admin.post(`/api/projects/${p.id}/items/${entry.item.id}/finalize`, {
      label: 'pos',
    });
    expect(fin.status).toBe(200);
    expect(fin.body.final).toMatchObject({ label: 'pos', source: 'review' });
  });

  it('lets another annotator take an item whose lease has expired', async () => {
    const p = await h.project({ name: 'lease' }, texts(1));
    const [a, b] = await Promise.all([h.user('lease-a'), h.user('lease-b')]);
    const qa = await next(a, p.id);
    expect((await next(b, p.id)).claim).toBeNull();
    await h.deps.db
      .update(annotations)
      .set({ leaseExpiresAt: sql`now() - interval '1 minute'` })
      .where(eq(annotations.id, qa.claim!.annotationId));
    expect((await next(b, p.id)).claim!.item.id).toBe(qa.claim!.item.id);
    // A comes back to an item someone else now holds: A is moved on, not double-served.
    expect((await next(a, p.id)).claim).toBeNull();
  });
});

describe('assignment ranges', () => {
  it('restricts ranged users to their range and everyone else to what is left', async () => {
    const p = await h.project({ name: 'ranges' }, texts(10));
    const [ranged, free] = await Promise.all([h.user('ranged'), h.user('free')]);
    const put = await h.admin.put(`/api/projects/${p.id}/assignments`, {
      ranges: [{ userId: ranged.me.id, seqFrom: 4, seqTo: 6 }],
    });
    expect(put.status).toBe(200);
    expect(put.body.ranges).toHaveLength(1);

    const qr = await next(ranged, p.id);
    expect(qr.claim!.item.seq).toBe(4);
    expect(qr.remaining).toBe(2);
    const qf = await next(free, p.id);
    expect(qf.claim!.item.seq).toBe(1);
    expect(qf.remaining).toBe(6); // 10 − 3 in the range − 1 claimed

    // What the admin reads back is exactly what was stored (v1 rebuilt it as 1..count).
    const get = await h.admin.get(`/api/projects/${p.id}/assignments`);
    expect(get.body.ranges[0]).toMatchObject({ seqFrom: 4, seqTo: 6 });

    const bad = await h.admin.put(`/api/projects/${p.id}/assignments`, {
      ranges: [{ userId: ranged.me.id, seqFrom: 5, seqTo: 50 }],
    });
    expect(bad.status).toBe(400);
  });
});

describe('skip, edit, review returns', () => {
  it('does not serve a skipped item again, but can take it back', async () => {
    const p = await h.project({ name: 'skip' }, texts(2));
    const ann = await h.user('skipper');
    const first = await next(ann, p.id);
    const after = await ann.post<QueueView>(
      `/api/projects/${p.id}/annotations/${first.claim!.annotationId}/skip`,
      {
        reason: 'unreadable',
      },
    );
    expect(after.body.claim!.item.seq).toBe(2);
    await ann.post(`/api/projects/${p.id}/annotations/${after.body.claim!.annotationId}/submit`, {
      label: 'pos',
    });
    expect((await next(ann, p.id)).claim).toBeNull();

    const back = await ann.post(
      `/api/projects/${p.id}/annotations/${first.claim!.annotationId}/reclaim`,
    );
    expect(back.status).toBe(200);
    expect(back.body.item.seq).toBe(1);
  });

  it('allows editing until the item is final, not after', async () => {
    const p = await h.project({ name: 'edit', settings: { autoFinalize: 'never' } }, texts(1));
    const ann = await h.user('editor');
    const q = await next(ann, p.id);
    const path = `/api/projects/${p.id}/annotations/${q.claim!.annotationId}`;
    await ann.post(`${path}/submit`, { label: 'pos' });
    expect((await ann.put(path, { label: 'neg' })).status).toBe(200);
    const history = await ann.get(`/api/projects/${p.id}/history`);
    expect(history.body[0]).toMatchObject({ label: 'neg', status: 'submitted', final: null });

    await h.admin.post(`/api/projects/${p.id}/items/${q.claim!.item.id}/finalize`, {
      label: 'neg',
    });
    const late = await ann.put(path, { label: 'pos' });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('item_finalized');
  });

  it('returns a rejected answer to its annotator, first, with the note', async () => {
    const p = await h.project({ name: 'reject', settings: { autoFinalize: 'never' } }, texts(3));
    const ann = await h.user('rejected-ann');
    const q = await next(ann, p.id);
    const submit = await ann.post<SubmitResult>(
      `/api/projects/${p.id}/annotations/${q.claim!.annotationId}/submit`,
      {
        label: 'pos',
      },
    );
    const secondItem = submit.body.next.claim!;
    expect(secondItem.item.seq).toBe(2);

    const rej = await h.admin.post(
      `/api/projects/${p.id}/annotations/${q.claim!.annotationId}/reject`,
      {
        note: 'Read the guideline on sarcasm.',
      },
    );
    expect(rej.status).toBe(200);

    // Finish the open claim; the returned item comes back before item 3.
    const res = await ann.post<SubmitResult>(
      `/api/projects/${p.id}/annotations/${secondItem.annotationId}/submit`,
      {
        label: 'neg',
      },
    );
    const returned = res.body.next.claim!;
    expect(returned.item.seq).toBe(1);
    expect(returned.returned!.note).toBe('Read the guideline on sarcasm.');
    expect(returned.current!.label).toBe('pos');

    // Returned work cannot be skipped away.
    const skip = await ann.post(
      `/api/projects/${p.id}/annotations/${returned.annotationId}/skip`,
      {},
    );
    expect(skip.status).toBe(409);
    const fixed = await ann.post<SubmitResult>(
      `/api/projects/${p.id}/annotations/${returned.annotationId}/submit`,
      {
        label: 'neg',
      },
    );
    expect(fixed.status).toBe(200);
    expect(fixed.body.next.claim!.item.seq).toBe(3);
  });

  it('holds flagged items for review even when everyone agrees', async () => {
    const p = await h.project({ name: 'flag' }, texts(1));
    const ann = await h.user('flagger');
    const q = await next(ann, p.id);
    const res = await ann.post<SubmitResult>(
      `/api/projects/${p.id}/annotations/${q.claim!.annotationId}/submit`,
      {
        label: 'pos',
        flagged: true,
        note: 'Two topics in one sentence',
      },
    );
    expect(res.body.finalized).toBe(false);
    const review = await h.admin.get<ReviewQueue>(`/api/projects/${p.id}/review?filter=flagged`);
    expect(review.body.entries[0]!.flagged).toBe(true);
  });
});

describe('NER', () => {
  it('validates spans against the text and stores offsets, deriving the text', async () => {
    const p = await h.project(
      { name: 'ner', type: 'ner', labels: labelsFromNames(['PER', 'LOC']) },
      ['张伟在北京工作', '李娜去上海了'],
    );
    const ann = await h.user('ner-ann');
    const q = await next(ann, p.id);
    const path = `/api/projects/${p.id}/annotations/${q.claim!.annotationId}/submit`;

    const outside = await ann.post(path, { spans: [{ start: 6, end: 9, label: 'LOC' }] });
    expect(outside.status).toBe(400);
    expect(outside.body.error.code).toBe('invalid_spans');
    const overlap = await ann.post(path, {
      spans: [
        { start: 0, end: 3, label: 'PER' },
        { start: 2, end: 5, label: 'LOC' },
      ],
    });
    expect(overlap.status).toBe(400);

    const ok = await ann.post(path, {
      spans: [
        { start: 3, end: 5, label: 'LOC' },
        { start: 0, end: 2, label: 'PER' },
      ],
    });
    expect(ok.status).toBe(200);
    const detail = await h.admin.get(`/api/projects/${p.id}/items/${q.claim!.item.id}`);
    expect(detail.body.final.spans).toEqual([
      { start: 0, end: 2, label: 'PER', text: '张伟' },
      { start: 3, end: 5, label: 'LOC', text: '北京' },
    ]);
  });
});

describe('permissions', () => {
  it('keeps annotators out of data, review and export', async () => {
    const p = await h.project({ name: 'perm' }, texts(2));
    const ann = await h.user('perm-ann');
    expect((await ann.get(`/api/projects/${p.id}/items`)).status).toBe(403);
    expect((await ann.get(`/api/projects/${p.id}/review`)).status).toBe(403);
    expect((await ann.get(`/api/projects/${p.id}/export`)).status).toBe(403);
    expect(
      (await ann.post(`/api/projects/${p.id}/items/batch`, { items: [{ text: 'x' }] })).status,
    ).toBe(403);
    expect((await ann.get(`/api/projects/${p.id}/queue`)).status).toBe(200);
  });

  it('lets a reviewer review and export but not manage', async () => {
    const p = await h.project({ name: 'perm-rev' }, texts(1));
    const rev = await h.user('perm-rev', 'reviewer');
    expect((await rev.get(`/api/projects/${p.id}/review`)).status).toBe(200);
    expect((await rev.get(`/api/projects/${p.id}/export`)).status).toBe(200);
    expect((await rev.patch(`/api/projects/${p.id}`, { name: 'renamed' })).status).toBe(403);
  });

  it('stops annotators touching someone else’s claim', async () => {
    const p = await h.project({ name: 'perm-claim' }, texts(2));
    const [a, b] = await Promise.all([h.user('owner-a'), h.user('thief-b')]);
    const qa = await next(a, p.id);
    const steal = await b.post(
      `/api/projects/${p.id}/annotations/${qa.claim!.annotationId}/submit`,
      { label: 'pos' },
    );
    expect(steal.status).toBe(403);
  });
});
