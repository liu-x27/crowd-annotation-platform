import type { QueueView } from '@crowd/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rows } from '../db/client';
import { shiftTimestamps } from '../db/shift-timestamps';
import { type Harness, harness, testContext } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await harness();
});
afterAll(async () => h.close());

describe('moving a demo database forward', () => {
  it('moves every timestamp by the same amount and leaves the rest alone', async () => {
    const p = await h.project({ name: 'timeline' }, ['first sentence', 'second sentence']);
    const ann = await h.user('timeline');
    const q = (await ann.get<QueueView>(`/api/projects/${p.id}/queue`)).body;
    await ann.post(`/api/projects/${p.id}/annotations/${q.claim!.annotationId}/submit`, {
      label: 'pos',
    });

    const read = () =>
      rows<{ id: number; label: string | null; times: (string | null)[] }>(
        h.deps.db,
        sql`select a.id, a.label, array[
              extract(epoch from a.created_at)::text, extract(epoch from a.submitted_at)::text,
              extract(epoch from a.lease_expires_at)::text, extract(epoch from i.created_at)::text,
              extract(epoch from i.finalized_at)::text, extract(epoch from u.created_at)::text
            ] as times
            from annotations a join items i on i.id = a.item_id join users u on u.id = a.user_id
            where a.project_id = ${p.id} order by a.id`,
      );
    const before = await read();
    const columns = await shiftTimestamps(h.deps.db, 10 * 86_400);
    const after = await read();

    expect(columns).toBeGreaterThanOrEqual(15);
    expect(after.map((r) => [r.id, r.label])).toEqual(before.map((r) => [r.id, r.label]));
    for (const [i, row] of after.entries()) {
      for (const [j, t] of row.times.entries()) {
        const was = before[i]!.times[j];
        if (was == null) expect(t).toBeNull();
        else expect(Number(t) - Number(was)).toBeCloseTo(10 * 86_400, 3);
      }
    }
  });
});

describe('LOW_MEMORY', () => {
  // The setting is the embedded database's; a Postgres server keeps its own configuration.
  it.skipIf(process.env.TEST_DATABASE_URL)(
    'gives the embedded Postgres a 16 MB buffer cache instead of 128 MB',
    async () => {
      const small = await testContext({ lowMemory: true });
      try {
        const show = async (db: Harness['deps']['db']) =>
          (await rows<{ shared_buffers: string }>(db, sql`show shared_buffers`))[0]!.shared_buffers;
        expect({ low: await show(small.deps.db), normal: await show(h.deps.db) }).toEqual({
          low: '16MB',
          normal: '128MB',
        });
      } finally {
        await small.close();
      }
    },
  );
});
