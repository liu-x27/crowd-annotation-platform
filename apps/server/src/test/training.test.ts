import type { JobView, ModelSummary, Prediction, TrainJobParams } from '@crowd/shared';
import { labelsFromNames } from '@crowd/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createContext } from '../app';
import { testConfig } from '../config';
import { getProject } from '../modules/projects/service';
import { runTraining } from '../modules/training/core';
import type { TrainingInput } from '../modules/training/data';
import { buildTrainingInput } from '../modules/training/data';
import { decodeModel } from '../modules/training/model-file';
import { spansToTags, tagsToSpans } from '../modules/training/perceptron';
import { type Harness, harness } from './harness';

const params = (over: Partial<TrainJobParams> = {}): TrainJobParams => ({
  source: 'final',
  reference: 'final',
  testFraction: 0.2,
  epochs: 8,
  hashBits: 14,
  seed: 7,
  ...over,
});

const topics: Record<string, string[]> = {
  sports: ['match', 'goal', 'league', 'coach', 'striker', 'season', '球队', '比赛'],
  finance: ['stock', 'bond', 'market', 'rates', 'earnings', 'bank', '股价', '银行'],
  tech: ['chip', 'software', 'phone', 'cloud', 'startup', 'model', '芯片', '手机'],
};

function synthetic(n: number, seed = 1): { text: string; label: string }[] {
  let s = seed;
  const r = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const labels = Object.keys(topics);
  return Array.from({ length: n }, (_, i) => {
    const label = labels[i % labels.length]!;
    const words = topics[label]!;
    const pick = () => words[Math.floor(r() * words.length)]!;
    return { text: `today ${pick()} and ${pick()} news, the ${pick()} report`, label };
  });
}

describe('student model core', () => {
  it('learns a separable classification task and beats the majority baseline', () => {
    const data = synthetic(300);
    const input: TrainingInput = {
      kind: 'classification',
      labels: Object.keys(topics),
      params: params(),
      train: data.slice(0, 240).map((d) => ({ text: d.text, label: d.label, spans: null })),
      test: data
        .slice(240)
        .map((d) => ({ text: d.text, label: d.label, spans: null, teacher: null })),
      trainBySource: { final: 240 },
    };
    const epochs: number[] = [];
    const { report, model } = runTraining(input, (e) => epochs.push(e.epoch));
    expect(epochs).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(report.history).toHaveLength(8);
    expect(report.history[7]!.trainLoss).toBeLessThan(report.history[0]!.trainLoss);
    expect(report.test.accuracy!).toBeGreaterThan(0.9);
    expect(report.baselines.simple.score!).toBeLessThan(0.5);
    expect(report.test.confusion!.labels).toEqual(Object.keys(topics));
    const decoded = decodeModel(model);
    expect(decoded.header).toMatchObject({ kind: 'classification', bits: 14 });
    expect(decoded.arrays.weights!.length).toBe((1 << 14) * 3);
  });

  it('converts between spans and BIO tags losslessly', () => {
    const labels = ['PER', 'LOC'];
    const spans = [
      { start: 0, end: 2, label: 'PER' },
      { start: 3, end: 5, label: 'LOC' },
      { start: 5, end: 7, label: 'LOC' },
    ];
    expect(tagsToSpans(spansToTags(8, spans, labels), labels)).toEqual(spans);
  });

  it('learns a toy NER task with the perceptron', () => {
    const names = ['张伟', '李娜', '王芳', '刘洋', '陈静', '杨帆'];
    const cities = ['北京', '上海', '杭州', '深圳', '成都', '武汉'];
    const make = (i: number) => {
      const n = names[i % names.length]!;
      const c = cities[(i * 5) % cities.length]!;
      const text = `${n}昨天去了${c}出差`;
      return {
        text,
        label: null,
        spans: [
          { start: 0, end: 2, label: 'PER' },
          { start: 6, end: 8, label: 'LOC' },
        ],
      };
    };
    const all = Array.from({ length: 60 }, (_, i) => make(i));
    const { report } = runTraining({
      kind: 'ner',
      labels: ['PER', 'LOC'],
      params: params({ epochs: 6 }),
      train: all.slice(0, 50),
      test: all.slice(50).map((e) => ({ ...e, teacher: null })),
      trainBySource: { final: 50 },
    });
    expect(report.test.microF1!).toBeGreaterThan(0.9);
    expect(report.baselines.simple.kind).toBe('dictionary');
  });
});

let h: Harness;
beforeAll(async () => {
  h = await harness();
});
afterAll(async () => h.close());

async function goldProject(n = 120) {
  const p = await h.project({
    name: `train-${Math.random()}`,
    labels: Object.keys(topics),
    settings: { llm: { provider: 'mock' } },
  });
  await h.admin.post(`/api/projects/${p.id}/items/batch`, {
    items: synthetic(n, 3).map((d) => ({ text: d.text, label: d.label })),
    finalizeImported: true,
  });
  return p;
}

describe('training data', () => {
  it('draws the test set first, so no test item ever contributes a training label', async () => {
    const p = await goldProject();
    await h.admin.post(`/api/projects/${p.id}/llm/jobs`, { scope: 'all' });
    await h.deps.jobs.idle();
    const project = await getProject(h.deps.db, p.id);
    for (const source of ['final', 'llm', 'llm+human'] as const) {
      const input = await buildTrainingInput(h.deps.db, project, params({ source }));
      const testTexts = new Set(input.test.map((t) => t.text));
      expect(input.train.some((t) => testTexts.has(t.text))).toBe(false);
      expect(input.test.length).toBeGreaterThan(15);
      expect(input.test.every((t) => t.teacher != null)).toBe(true);
    }
  });

  it('refuses to train without enough reference labels', async () => {
    const p = await h.project({ name: 'tiny' }, ['a', 'b']);
    const res = await h.admin.post<JobView>(`/api/projects/${p.id}/models`, {});
    await h.deps.jobs.idle();
    const job = (await h.admin.get<JobView>(`/api/jobs/${res.body.id}`)).body;
    expect(job.status).toBe('failed');
    expect(job.error).toMatch(/at least 5/);
  });
});

describe('training through the API', () => {
  it('trains, reports real epochs, and predicts', async () => {
    const p = await goldProject();
    const events: number[] = [];
    const unsubscribe = h.deps.bus.subscribe((e) => {
      if (e.type === 'epoch' && e.projectId === p.id) events.push(e.epoch.epoch);
    });
    const res = await h.admin.post<JobView>(`/api/projects/${p.id}/models`, {
      epochs: 5,
      hashBits: 14,
    });
    expect(res.status).toBe(202);
    await h.deps.jobs.idle();
    unsubscribe();
    expect(events).toEqual([1, 2, 3, 4, 5]);

    const models = await h.admin.get<ModelSummary[]>(`/api/projects/${p.id}/models`);
    const m = models.body[0]!;
    expect(m.status).toBe('succeeded');
    expect(m.report!.history).toHaveLength(5);
    expect(m.report!.test.accuracy!).toBeGreaterThan(0.8);

    const pred = await h.admin.post<Prediction>(`/api/projects/${p.id}/models/${m.jobId}/predict`, {
      text: 'the striker scored a goal for the league leaders',
    });
    expect(pred.body.label).toBe('sports');
    expect(pred.body.probabilities[0]!.p).toBeGreaterThan(pred.body.probabilities[1]!.p);
  });

  it('trains an NER tagger and returns spans', async () => {
    const p = await h.project({
      name: 'ner-train',
      type: 'ner',
      labels: labelsFromNames(['PER', 'LOC']),
    });
    const names = ['张伟', '李娜', '王芳', '刘洋'];
    const cities = ['北京', '上海', '杭州', '深圳'];
    await h.admin.post(`/api/projects/${p.id}/items/batch`, {
      items: Array.from({ length: 40 }, (_, i) => ({
        text: `${names[i % 4]}在${cities[(i >> 2) % 4]}工作了${i}年`,
        spans: [
          { start: 0, end: 2, label: 'PER' },
          { start: 3, end: 5, label: 'LOC' },
        ],
      })),
      finalizeImported: true,
      dedupe: false,
    });
    await h.admin.post(`/api/projects/${p.id}/models`, { epochs: 5, hashBits: 14 });
    await h.deps.jobs.idle();
    const [m] = (await h.admin.get<ModelSummary[]>(`/api/projects/${p.id}/models`)).body;
    expect(m!.status).toBe('succeeded');
    const pred = await h.admin.post<Prediction>(
      `/api/projects/${p.id}/models/${m!.jobId}/predict`,
      { text: '王芳在北京工作' },
    );
    expect(pred.body.spans).toEqual([
      { start: 0, end: 2, label: 'PER', text: '王芳' },
      { start: 3, end: 5, label: 'LOC', text: '北京' },
    ]);
  });
});

describe('worker thread', () => {
  it('runs training off the main thread', async () => {
    const ctx = await createContext(testConfig(), { inProcessTraining: false });
    const { createApp } = await import('../app');
    const { Client, PASSWORD } = await import('./harness');
    try {
      await ctx.deps.jobs.start();
      const admin = new Client(createApp(ctx.deps));
      await admin.post('/api/auth/setup', { username: 'admin', password: PASSWORD });
      const p = await admin.post('/api/projects', {
        name: 'w',
        type: 'classification',
        labels: labelsFromNames(Object.keys(topics)),
      });
      await admin.post(`/api/projects/${p.body.id}/items/batch`, {
        items: synthetic(60, 5).map((d) => ({ text: d.text, label: d.label })),
        finalizeImported: true,
      });
      await admin.post(`/api/projects/${p.body.id}/models`, { epochs: 3, hashBits: 13 });
      await ctx.deps.jobs.idle();
      const [m] = (await admin.get<ModelSummary[]>(`/api/projects/${p.body.id}/models`)).body;
      expect(m!.status).toBe('succeeded');
      expect(m!.report!.history).toHaveLength(3);
    } finally {
      await ctx.close();
    }
  });
});
