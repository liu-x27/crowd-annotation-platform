import type { JobKind, JobProgress, JobView, ServerEvent } from '@crowd/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { type JobRow, jobs, users } from '../db/schema';
import type { EventBus } from '../events/bus';
import { jobView, userRef } from '../lib/dto';
import { conflict, notFound } from '../lib/errors';

export interface JobContext {
  job: JobRow;
  signal: AbortSignal;
  /** Merge into the job's progress. Persisted and broadcast at a bounded rate. */
  progress(update: Partial<JobProgress>): void;
  publish(event: ServerEvent): void;
}

export type JobHandler = (ctx: JobContext) => Promise<unknown>;

export class JobCancelled extends Error {
  constructor() {
    super('cancelled');
  }
}

/**
 * A small in-process job queue backed by the `jobs` table. One job per kind runs at a time
 * (each job parallelises internally). Jobs that were running when the process stopped are
 * re-queued on start; the handlers are written to be resumable.
 */
export class JobRunner {
  private readonly handlers = new Map<JobKind, JobHandler>();
  private readonly controllers = new Map<number, AbortController>();
  private readonly running = new Map<number, Promise<void>>();
  private readonly activeKinds = new Set<JobKind>();
  private stopped = false;

  constructor(
    private readonly db: Db,
    private readonly bus: EventBus,
  ) {}

  register(kind: JobKind, handler: JobHandler): void {
    this.handlers.set(kind, handler);
  }

  async start(): Promise<void> {
    await this.db
      .update(jobs)
      .set({ status: 'queued', startedAt: null })
      .where(eq(jobs.status, 'running'));
    void this.pump();
  }

  async enqueue(input: {
    kind: JobKind;
    projectId: number | null;
    params: Record<string, unknown>;
    createdBy: number | null;
  }): Promise<JobView> {
    if (input.projectId != null) {
      const [active] = await this.db
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(
            eq(jobs.projectId, input.projectId),
            eq(jobs.kind, input.kind),
            inArray(jobs.status, ['queued', 'running']),
          ),
        )
        .limit(1);
      if (active) {
        throw conflict(
          'job_active',
          `A ${input.kind} job is already queued or running for this project.`,
          {
            jobId: active.id,
          },
        );
      }
    }
    const [row] = await this.db
      .insert(jobs)
      .values({
        kind: input.kind,
        projectId: input.projectId,
        params: input.params,
        status: 'queued',
        createdBy: input.createdBy,
      })
      .returning();
    const view = await this.view(row!);
    this.bus.publish({ type: 'job', job: view });
    void this.pump();
    return view;
  }

  async cancel(jobId: number): Promise<JobView> {
    const [row] = await this.db.select().from(jobs).where(eq(jobs.id, jobId));
    if (!row) throw notFound('Job');
    const controller = this.controllers.get(jobId);
    if (controller) {
      controller.abort(new JobCancelled());
      await this.running.get(jobId);
    } else if (row.status === 'queued') {
      await this.db
        .update(jobs)
        .set({ status: 'cancelled', finishedAt: new Date() })
        .where(eq(jobs.id, jobId));
      await this.broadcast(jobId);
    }
    const [after] = await this.db.select().from(jobs).where(eq(jobs.id, jobId));
    return this.view(after!);
  }

  async list(filter: { projectId?: number; limit?: number } = {}): Promise<JobView[]> {
    const rowsFound = await this.db
      .select()
      .from(jobs)
      .where(filter.projectId != null ? eq(jobs.projectId, filter.projectId) : undefined)
      .orderBy(desc(jobs.id))
      .limit(filter.limit ?? 50);
    return Promise.all(rowsFound.map((r) => this.view(r)));
  }

  async get(jobId: number): Promise<JobView> {
    const [row] = await this.db.select().from(jobs).where(eq(jobs.id, jobId));
    if (!row) throw notFound('Job');
    return this.view(row);
  }

  /** Wait until nothing is queued or running. For tests and scripts. */
  async idle(): Promise<void> {
    for (;;) {
      await Promise.all([...this.running.values()]);
      const [waiting] = await this.db
        .select({ id: jobs.id })
        .from(jobs)
        .where(inArray(jobs.status, ['queued', 'running']))
        .limit(1);
      if (!waiting || this.stopped) return;
      await this.pump();
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const c of this.controllers.values()) c.abort(new Error('server shutting down'));
    await Promise.allSettled([...this.running.values()]);
  }

  private async pump(): Promise<void> {
    if (this.stopped) return;
    const queued = await this.db
      .select()
      .from(jobs)
      .where(eq(jobs.status, 'queued'))
      .orderBy(jobs.id)
      .limit(20);
    for (const job of queued) {
      if (this.activeKinds.has(job.kind) || this.running.has(job.id)) continue;
      const handler = this.handlers.get(job.kind);
      if (!handler) continue;
      this.activeKinds.add(job.kind);
      const run = this.run(job, handler).finally(() => {
        this.activeKinds.delete(job.kind);
        this.running.delete(job.id);
        this.controllers.delete(job.id);
        void this.pump();
      });
      this.running.set(job.id, run);
    }
  }

  private async run(job: JobRow, handler: JobHandler): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    const startedAt = new Date();
    await this.db
      .update(jobs)
      .set({ status: 'running', startedAt, error: null })
      .where(eq(jobs.id, job.id));
    await this.broadcast(job.id);

    let progress: JobProgress = { ...job.progress };
    let lastWrite = 0;
    let writing: Promise<unknown> = Promise.resolve();
    const flush = async () => {
      lastWrite = Date.now();
      await this.db.update(jobs).set({ progress }).where(eq(jobs.id, job.id));
      await this.broadcast(job.id);
    };

    const ctx: JobContext = {
      job: { ...job, status: 'running', startedAt },
      signal: controller.signal,
      progress: (update) => {
        progress = { ...progress, ...update };
        if (Date.now() - lastWrite > 300) writing = writing.then(flush);
      },
      publish: (event) => this.bus.publish(event),
    };

    try {
      const result = await handler(ctx);
      await writing;
      await this.db
        .update(jobs)
        .set({ status: 'succeeded', progress, result: result ?? null, finishedAt: new Date() })
        .where(eq(jobs.id, job.id));
    } catch (err) {
      await writing.catch(() => undefined);
      const cancelled =
        controller.signal.aborted && controller.signal.reason instanceof JobCancelled;
      const interrupted = controller.signal.aborted && !cancelled;
      if (interrupted) {
        // Shutdown: leave it queued so the next start resumes it.
        await this.db.update(jobs).set({ status: 'queued', progress }).where(eq(jobs.id, job.id));
      } else {
        await this.db
          .update(jobs)
          .set({
            status: cancelled ? 'cancelled' : 'failed',
            progress,
            error: cancelled ? null : err instanceof Error ? err.message : String(err),
            finishedAt: new Date(),
          })
          .where(eq(jobs.id, job.id));
        if (!cancelled) console.error(`[job ${job.id}] ${job.kind} failed:`, err);
      }
    }
    await this.broadcast(job.id);
  }

  private async broadcast(jobId: number): Promise<void> {
    if (this.stopped) return;
    const [row] = await this.db.select().from(jobs).where(eq(jobs.id, jobId));
    if (row) this.bus.publish({ type: 'job', job: await this.view(row) });
  }

  private async view(row: JobRow): Promise<JobView> {
    let creator = null;
    if (row.createdBy != null) {
      const [u] = await this.db.select().from(users).where(eq(users.id, row.createdBy));
      creator = userRef(u);
    }
    return jobView(row, creator);
  }
}
