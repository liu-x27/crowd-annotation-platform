import { Worker } from 'node:worker_threads';
import {
  type EpochStats,
  type ModelSummary,
  type TrainReport,
  trainJobSchema,
} from '@crowd/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { jobs } from '../../db/schema';
import type { JobHandler } from '../../jobs/runner';
import { iso } from '../../lib/dto';
import { getProject } from '../projects/service';
import { runTraining, type TrainingOutput } from './core';
import { buildTrainingInput, type TrainingInput } from './data';
import type { ModelStore } from './store';

function workerEntry(): { url: URL; execArgv: string[] } {
  const here = import.meta.url;
  // From source (tsx, tests) the worker is TypeScript; in the build it is a sibling bundle.
  return here.endsWith('.ts')
    ? { url: new URL('./worker.ts', here), execArgv: ['--import', 'tsx'] }
    : { url: new URL('./train-worker.js', here), execArgv: [] };
}

function runInWorker(
  input: TrainingInput,
  onEpoch: (e: EpochStats) => void,
  signal: AbortSignal,
): Promise<TrainingOutput> {
  const { url, execArgv } = workerEntry();
  return new Promise((resolve, reject) => {
    const worker = new Worker(url, { workerData: input, execArgv });
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      fn();
    };
    const onAbort = () => {
      void worker.terminate();
      finish(() => reject(signal.reason));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    worker.on(
      'message',
      (msg: {
        type: string;
        epoch?: EpochStats;
        report?: TrainReport;
        model?: Uint8Array;
        message?: string;
      }) => {
        if (msg.type === 'epoch' && msg.epoch) onEpoch(msg.epoch);
        else if (msg.type === 'done')
          finish(() => resolve({ report: msg.report!, model: new Uint8Array(msg.model!) }));
        else if (msg.type === 'error') finish(() => reject(new Error(msg.message)));
      },
    );
    worker.on('error', (err) => finish(() => reject(err)));
    worker.on('exit', (code) =>
      finish(() => reject(new Error(`training worker exited with code ${code}`))),
    );
  });
}

export function createTrainHandler(deps: {
  db: Db;
  models: ModelStore;
  inProcess?: boolean;
}): JobHandler {
  return async (ctx) => {
    const params = trainJobSchema.parse(ctx.job.params);
    const project = await getProject(deps.db, ctx.job.projectId!);
    const input = await buildTrainingInput(deps.db, project, params);
    ctx.progress({
      total: params.epochs,
      done: 0,
      failed: 0,
      message: `${input.train.length} training labels, ${input.test.length} test items`,
    });
    const onEpoch = (epoch: EpochStats) => {
      ctx.progress({ done: epoch.epoch });
      ctx.publish({ type: 'epoch', jobId: ctx.job.id, projectId: project.id, epoch });
    };
    const out = deps.inProcess
      ? runTraining(input, onEpoch)
      : await runInWorker(input, onEpoch, ctx.signal);
    await deps.models.save(ctx.job.id, out.model);
    return out.report;
  };
}

export async function listModels(db: Db, projectId: number): Promise<ModelSummary[]> {
  const found = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.projectId, projectId), eq(jobs.kind, 'train')))
    .orderBy(desc(jobs.id))
    .limit(50);
  return found.map((j) => ({
    jobId: j.id,
    status: j.status,
    createdAt: iso(j.createdAt)!,
    finishedAt: iso(j.finishedAt),
    params: trainJobSchema.parse(j.params),
    report: j.status === 'succeeded' ? (j.result as TrainReport) : null,
    error: j.error,
  }));
}

export { getProject };
