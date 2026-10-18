import type { QueueView, SubmitResult } from '@crowd/shared';
import { sql } from 'drizzle-orm';
import { Client as PgClient } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { rows } from '../db/client';
import { type Client, type Harness, harness } from './harness';

/**
 * What only exists with more than one connection. On PGlite every query runs on one
 * connection, so these are skipped there; CI runs them against a Postgres server
 * (TEST_DATABASE_URL), where requests the app handles at once hold separate pool
 * connections, and the raw connections below can hold a transaction open in between.
 */
describe.runIf(process.env.TEST_DATABASE_URL)('on a Postgres server', () => {
  let h: Harness;
  let monitor: PgClient;
  const open: PgClient[] = [];

  beforeAll(async () => {
    h = await harness();
    monitor = await connect();
  });
  afterEach(async () => {
    for (const c of open.splice(1)) await c.end().catch(() => undefined);
  });
  afterAll(async () => {
    await monitor?.end().catch(() => undefined);
    await h?.close();
  });

  /** A connection of its own to the test database, outside the app's pool. */
  async function connect(): Promise<PgClient> {
    const c = new PgClient({ connectionString: h.databaseUrl! });
    await c.connect();
    open.push(c);
    return c;
  }

  /** Whether another connection is running a statement that matches `pattern`. */
  async function running(
    pattern: string,
    opts: { waiting?: boolean; forMs?: number } = {},
  ): Promise<boolean> {
    const found = await monitor.query(
      `select 1 from pg_stat_activity
       where datname = current_database() and pid <> pg_backend_pid()
         and state = 'active' and query ilike $1
         and ($2::boolean is not true or wait_event_type = 'Lock')
         and clock_timestamp() - query_start >= make_interval(secs => $3::float8 / 1000)`,
      [pattern, opts.waiting ?? false, opts.forMs ?? 0],
    );
    return (found.rowCount ?? 0) > 0;
  }

  /**
   * Resolves once another connection is running a statement that matches `pattern` — for
   * at least `forMs`, or, with `waiting`, blocked on a lock in it.
   */
  async function seen(
    pattern: string,
    opts: { waiting?: boolean; forMs?: number } = {},
  ): Promise<void> {
    const deadline = Date.now() + 15_000;
    while (!(await running(pattern, opts))) {
      if (Date.now() > deadline) throw new Error(`no statement like ${pattern} was seen`);
    }
  }

  const texts = (n: number, prefix = 'item') =>
    Array.from({ length: n }, (_, i) => `${prefix} number ${i + 1}`);

  async function queue(c: Client, projectId: number): Promise<QueueView> {
    const res = await c.get<QueueView>(`/api/projects/${projectId}/queue`);
    expect(res.status).toBe(200);
    return res.body;
  }

  /** Claim and submit until the queue is empty. */
  async function work(c: Client, projectId: number, label = 'pos'): Promise<void> {
    let claim = (await queue(c, projectId)).claim;
    while (claim) {
      const res = await c.post<SubmitResult>(
        `/api/projects/${projectId}/annotations/${claim.annotationId}/submit`,
        { label },
      );
      expect(res.status).toBe(200);
      claim = res.body.next.claim;
    }
  }

  /** Answers and live claims on an item: what redundancy limits. */
  async function holding(itemId: number): Promise<number> {
    const [row] = await rows<{ n: number }>(
      h.deps.db,
      sql`select count(*)::int as n from annotations
          where item_id = ${itemId} and source = 'human'
            and (status = 'submitted' or (status = 'claimed' and lease_expires_at > now()))`,
    );
    return row!.n;
  }

  /** A claim on `itemId`, in a transaction left open: it holds the item until it commits. */
  async function pendingClaim(projectId: number, itemId: number, userId: number) {
    const c = await connect();
    await c.query('begin');
    await c.query('select id from items where id = $1 for update', [itemId]);
    await c.query(
      `insert into annotations (project_id, item_id, source, user_id, status, lease_expires_at)
       values ($1, $2, 'human', $3, 'claimed', now() + interval '30 minutes')`,
      [projectId, itemId, userId],
    );
    return c;
  }

  describe('claims', () => {
    it.each([1, 2])(
      'with redundancy %i, gives each item to exactly that many people when twelve claim and submit at once',
      async (k) => {
        // Consensus off, so a double claim stays as one answer too many rather than
        // turning into a 409 for whoever submits second.
        const p = await h.project(
          { name: `stampede-${k}`, settings: { redundancy: k, autoFinalize: 'never' } },
          texts(120, `stampede ${k}`),
        );
        const people = await Promise.all(
          Array.from({ length: 12 }, (_, i) => h.user(`stampede-${k}-${i}`)),
        );
        await Promise.all(people.map((c) => work(c, p.id)));

        const perItem = await rows<{ people: number; items: number }>(
          h.deps.db,
          sql`select people, count(*)::int as items from (
                select count(distinct a.user_id)::int as people from items i
                left join annotations a on a.item_id = i.id and a.source = 'human'
                where i.project_id = ${p.id} group by i.id
              ) x group by people`,
        );
        expect(perItem).toEqual([{ people: k, items: 120 }]);
      },
    );

    it('gives one person asking from five tabs at once one claim', async () => {
      const p = await h.project({ name: 'tabs' }, texts(10, 'tabs'));
      const ann = await h.user('tabs');
      const views = await Promise.all(Array.from({ length: 5 }, () => queue(ann, p.id)));
      expect(new Set(views.map((v) => v.claim!.annotationId)).size).toBe(1);
      const [open] = await rows<{ n: number }>(
        h.deps.db,
        sql`select count(*)::int as n from annotations where project_id = ${p.id} and status = 'claimed'`,
      );
      expect(open!.n).toBe(1);
    });
  });

  /**
   * SKIP LOCKED passes over an item another claim is holding. But the claim's filter reads
   * a snapshot taken when its statement began: a claim on the same item that commits while
   * the scan is still on its way there is invisible to it, and having committed it no longer
   * holds the lock, so nothing stops the item being taken twice. A long run of items held by
   * someone else ahead of the contested one makes the scan slow enough to commit inside it.
   */
  describe('a claim that commits while another is scanning towards the same item', () => {
    const AHEAD = 100_000;

    async function contested(name: string) {
      const p = await h.project({ name });
      const holder = await h.user(`${name}-holder`);
      await h.deps.db.execute(sql`
        insert into items (project_id, seq, text, text_hash)
        select ${p.id}::int, g, ${name}::text || ' ' || g, md5(${name}::text || ' ' || g)
        from generate_series(1, ${AHEAD + 2}::int) g`);
      await h.deps.db.execute(sql`
        insert into annotations (project_id, item_id, source, user_id, status, lease_expires_at)
        select project_id, id, 'human', ${holder.me.id}, 'claimed', now() + interval '1 hour'
        from items where project_id = ${p.id} and seq <= ${AHEAD}`);
      await h.deps.db.execute(sql`analyze items`);
      await h.deps.db.execute(sql`analyze annotations`);
      const [x] = await rows<{ id: number }>(
        h.deps.db,
        sql`select id from items where project_id = ${p.id} and seq = ${AHEAD + 1}`,
      );
      const [first, second] = await Promise.all([
        h.user(`${name}-first`),
        h.user(`${name}-second`),
      ]);
      return { projectId: p.id, x: x!.id, first, second };
    }

    /**
     * Start `claim`, and commit `pending` while the claim's scan is under way. A statement
     * shows as active from the moment it is parsed, before it takes its snapshot, so the
     * commit waits until it has run for 50 ms; and the scan must still be running after the
     * commit, or it may have reached the item while the item was still locked.
     */
    async function commitMidScan<T>(pending: PgClient, claim: () => Promise<T>) {
      const started = performance.now();
      const claiming = claim();
      await seen('%skip locked%', { forMs: 50 });
      await pending.query('commit');
      const stillScanning = await running('%skip locked%');
      const result = await claiming;
      return { result, stillScanning, ms: Math.round(performance.now() - started) };
    }

    it('is taken again by a claim made in a single statement (the window is real)', async ({
      annotate,
    }) => {
      const { projectId, x, first, second } = await contested('window');
      const pending = await pendingClaim(projectId, x, first.me.id);
      const conn = await connect();
      // Select-and-insert in one statement, the way claims used to be made.
      const { result, stillScanning, ms } = await commitMidScan(pending, () =>
        conn.query<{ item_id: number }>(
          `with candidate as (
             select i.id from items i
             where i.project_id = $1 and i.finalized_at is null
               and (select count(*) from annotations a
                    where a.item_id = i.id and a.source = 'human'
                      and (a.status = 'submitted'
                           or (a.status = 'claimed' and a.lease_expires_at > now()))) < 1
             order by i.seq limit 1
             for update of i skip locked)
           insert into annotations (project_id, item_id, source, user_id, status, lease_expires_at)
           select $1, id, 'human', $2, 'claimed', now() + interval '30 minutes' from candidate
           returning item_id`,
          [projectId, second.me.id],
        ),
      );
      await annotate(
        `A one-statement claim past ${AHEAD} held items took ${ms} ms; the commit landed mid-scan: ${stillScanning}`,
        'notice',
      );
      expect(stillScanning).toBe(true);
      expect({ taken: result.rows.map((r) => r.item_id), holders: await holding(x) }).toEqual({
        taken: [x],
        holders: 2,
      });
    });

    it('is not taken again by the queue, which serves the next item instead', async ({
      annotate,
    }) => {
      const { projectId, x, first, second } = await contested('queue');
      const pending = await pendingClaim(projectId, x, first.me.id);
      const { result, stillScanning, ms } = await commitMidScan(pending, () =>
        queue(second, projectId),
      );
      await annotate(
        `The queue past ${AHEAD} held items took ${ms} ms; the commit landed mid-scan: ${stillScanning}`,
        'notice',
      );
      expect(stillScanning).toBe(true);
      expect({ served: result.claim!.item.seq, holders: await holding(x) }).toEqual({
        served: AHEAD + 2,
        holders: 1,
      });
    });
  });

  /**
   * A claim whose lease has run out is renewed when its owner comes back, unless the item
   * has meanwhile gone to as many other people as its redundancy asks for, or been finalised.
   * Either can be under way, not yet committed, when the owner asks: a fresh claim holds the
   * item while it inserts, and so does a reviewer finalising it, who also drops the claims
   * left open on it. Raw connections hold those transactions open here.
   */
  describe('an expired claim whose owner comes back while the item is being taken', () => {
    /** A one-item project with redundancy 1, claimed by `owner`, whose lease has run out. */
    async function lapsed(name: string) {
      const p = await h.project({ name, settings: { redundancy: 1 } }, [`${name} item`]);
      const [owner, other] = await Promise.all([h.user(`${name}-owner`), h.user(`${name}-other`)]);
      const { claim } = await queue(owner, p.id);
      await h.deps.db.execute(
        sql`update annotations set lease_expires_at = now() - interval '1 minute'
            where id = ${claim!.annotationId}`,
      );
      return { projectId: p.id, x: claim!.item.id, owner, other };
    }

    /**
     * Whether `request` waits on a lock before it finishes. It is left running either way:
     * the caller commits whatever it may be waiting for, then awaits it.
     */
    async function waitsOnLock(request: Promise<unknown>): Promise<boolean> {
      let done = false;
      const settle = () => {
        done = true;
      };
      request.then(settle, settle);
      const deadline = Date.now() + 15_000;
      while (!done) {
        if (await running('%', { waiting: true })) return true;
        if (Date.now() > deadline) throw new Error('the request neither finished nor waited');
      }
      return false;
    }

    it('is not renewed beside a fresh claim on the item that has not committed yet', async ({
      annotate,
    }) => {
      const { projectId, x, owner, other } = await lapsed('lapsed-claimed');
      const pending = await pendingClaim(projectId, x, other.me.id);
      const asking = queue(owner, projectId);
      const waited = await waitsOnLock(asking);
      await pending.query('commit');
      const view = await asking;
      await annotate(`The owner waited for the fresh claim to commit: ${waited}`, 'notice');
      expect({ served: view.claim?.item.id ?? null, holders: await holding(x) }).toEqual({
        served: null,
        holders: 1,
      });
    });

    it('is let go, not answered with a 500, when a reviewer finalising the item drops it', async ({
      annotate,
    }) => {
      const { projectId, x, owner } = await lapsed('lapsed-final');
      // What finalizeOpenItem does, in a transaction left open.
      const reviewer = await connect();
      await reviewer.query('begin');
      await reviewer.query('select id from items where id = $1 for update', [x]);
      await reviewer.query(
        `update items set final_label = 'pos', final_source = 'review', finalized_at = now()
         where id = $1`,
        [x],
      );
      await reviewer.query(
        `delete from annotations
         where item_id = $1 and source = 'human' and status = 'claimed' and submitted_at is null`,
        [x],
      );
      const asking = owner.get<QueueView>(`/api/projects/${projectId}/queue`);
      const waited = await waitsOnLock(asking);
      await reviewer.query('commit');
      const res = await asking;
      await annotate(`The owner waited for the reviewer to commit: ${waited}`, 'notice');
      expect({ status: res.status, served: res.body.claim?.item.id ?? null }).toEqual({
        status: 200,
        served: null,
      });
    });
  });

  describe('bulk review', () => {
    it('waits for an answer being changed on an item it is deciding, then judges the new answers', async () => {
      const p = await h.project(
        { name: 'bulk-wait', settings: { redundancy: 2, autoFinalize: 'never' } },
        texts(4, 'bulk wait'),
      );
      const [a, b] = await Promise.all([h.user('bulk-wait-a'), h.user('bulk-wait-b')]);
      await work(a, p.id, 'pos');
      await work(b, p.id, 'pos');
      const ids = (
        await rows<{ id: number }>(
          h.deps.db,
          sql`select id from items where project_id = ${p.id} order by seq`,
        )
      ).map((r) => r.id);

      // B is changing their answer on the third item, holding the item as an edit does.
      const editing = await connect();
      await editing.query('begin');
      await editing.query('select id from items where id = $1 for update', [ids[2]]);
      await editing.query(
        `update annotations set label = 'neg' where item_id = $1 and user_id = $2 and source = 'human'`,
        [ids[2], b.me.id],
      );
      const bulk = h.admin.post(`/api/projects/${p.id}/review/bulk-finalize`, {
        strategy: 'unanimous',
      });
      await seen('%for update%', { waiting: true });
      await editing.query('commit');

      const res = await bulk;
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ finalized: 3, skipped: 1 });
      const finals = await rows<{ final_label: string | null }>(
        h.deps.db,
        sql`select final_label from items where project_id = ${p.id} order by seq`,
      );
      expect(finals.map((r) => r.final_label)).toEqual(['pos', 'pos', null, 'pos']);
    });

    it('lets two reviewers bulk-finalise the same 600 items at once: each decided once, no deadlock', async () => {
      const p = await h.project(
        { name: 'bulk-pair', settings: { redundancy: 1, autoFinalize: 'never' } },
        texts(600, 'bulk pair'),
      );
      const ann = await h.user('bulk-pair-ann');
      await h.deps.db.execute(sql`
        insert into annotations (project_id, item_id, source, user_id, status, label, submitted_at)
        select project_id, id, 'human', ${ann.me.id}, 'submitted', 'pos', now()
        from items where project_id = ${p.id}`);
      await h.deps.db.execute(sql`update items set human_count = 1 where project_id = ${p.id}`);
      const ids = (
        await rows<{ id: number }>(
          h.deps.db,
          sql`select id from items where project_id = ${p.id} order by seq`,
        )
      ).map((r) => r.id);
      const second = await h.user('bulk-pair-rev', 'reviewer');

      const [one, two] = await Promise.all([
        h.admin.post(`/api/projects/${p.id}/review/bulk-finalize`, {
          strategy: 'unanimous',
          itemIds: ids,
        }),
        second.post(`/api/projects/${p.id}/review/bulk-finalize`, {
          strategy: 'unanimous',
          itemIds: [...ids].reverse(),
        }),
      ]);
      expect([one.status, two.status]).toEqual([200, 200]);
      expect(one.body.finalized + two.body.finalized).toBe(600);
      expect(one.body.skipped + two.body.skipped).toBe(600);
      const [final] = await rows<{ n: number; by: number }>(
        h.deps.db,
        sql`select count(*)::int as n, count(distinct finalized_by)::int as by
            from items where project_id = ${p.id} and final_label = 'pos'`,
      );
      expect(final!.n).toBe(600);
      expect(final!.by).toBeLessThanOrEqual(2);
    });
  });
});
