import bcrypt from 'bcryptjs';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Context, createApp, createContext } from '../app';
import { testConfig } from '../config';
import { annotations, assignments, items, projects } from '../db/schema';
import { Client } from '../test/harness';
import { convertSpans, type MigrationReport, migrateV1, toRanges, type V1Data } from './migrate';

const at = (iso: string) => new Date(iso);

/**
 * A miniature of the real v1 database, reproducing what was found in it: gold labels
 * bulk-written as "human" annotations, duplicate LLM drafts that disagree, the hard-coded
 * 0.9 confidence, a per-sample assignment, and NER spans whose offsets point past the text.
 */
async function fixture(): Promise<V1Data> {
  const hash = await bcrypt.hash('v1-password', 4);
  const burst = Array.from({ length: 120 }, (_, i) => ({
    _id: `s-gold-${i}`,
    taskId: 't-news',
    content: `新闻 ${i}：${i % 2 ? '球队赢了比赛' : '股价上涨'}`,
    createdAt: at('2026-07-30T02:26:00Z'),
  }));
  return {
    users: [
      {
        _id: 'u-admin',
        username: 'admin',
        passwordHash: hash,
        role: 'admin',
        createdAt: at('2025-12-22T13:54:58Z'),
      },
      { _id: 'u-ann', username: 'employee1', passwordHash: hash, role: 'annotator' },
    ],
    tasks: [
      {
        _id: 't-news',
        name: 'TNEWS',
        type: 'text_classification',
        labels: ['体育', '财经'],
        createdAt: at('2026-07-30T02:26:05Z'),
      },
      {
        _id: 't-ner',
        name: 'NER2',
        type: 'ner',
        labels: ['PER', 'TIME', 'AGE'],
        createdAt: at('2026-04-17T02:32:07Z'),
      },
    ],
    samples: [
      ...burst,
      {
        _id: 's-ui-1',
        taskId: 't-news',
        content: '手工标注的一条',
        createdAt: at('2026-07-30T03:00:00Z'),
        assignedTo: 'u-ann',
      },
      {
        _id: 's-ui-2',
        taskId: 't-news',
        content: '又一条手工标注',
        createdAt: at('2026-07-30T03:00:01Z'),
        assignedTo: 'u-ann',
      },
      {
        _id: 's-ner-1',
        taskId: 't-ner',
        content: '那段岁月让我成长了',
        createdAt: at('2026-04-17T02:33:00Z'),
      },
      {
        _id: 's-ner-2',
        taskId: 't-ner',
        content: '张伟今年三十岁',
        createdAt: at('2026-04-17T02:33:01Z'),
      },
    ],
    annotations: [
      // 120 gold labels written by a script in one minute, attributed to the admin.
      ...burst.map((s, i) => ({
        _id: `a-gold-${i}`,
        taskId: 't-news',
        sampleId: s._id,
        userId: 'u-admin',
        label: i % 2 ? '体育' : '财经',
        fromLLM: false,
        status: 'approved',
        createdAt: at('2026-07-30T02:26:30Z'),
      })),
      // Two drafts for one sample, created an hour apart, disagreeing; one has the fake 0.9.
      {
        _id: 'd-1',
        taskId: 't-news',
        sampleId: 's-gold-0',
        label: '体育',
        fromLLM: true,
        confidence: 0.9,
        status: 'pending',
        createdAt: at('2026-07-30T04:00:00Z'),
      },
      {
        _id: 'd-2',
        taskId: 't-news',
        sampleId: 's-gold-0',
        label: '财经',
        fromLLM: true,
        confidence: 0.9,
        status: 'pending',
        createdAt: at('2026-07-30T05:00:00Z'),
      },
      // A research-pipeline draft with a real confidence and a recorded model.
      {
        _id: 'd-3',
        taskId: 't-news',
        sampleId: 's-gold-1',
        label: '体育',
        fromLLM: true,
        confidence: 0.97,
        status: 'approved',
        createdAt: at('2026-07-30T04:00:00Z'),
        meta: { source: 'llm_soft_labels.py', model: 'qwen3:14b' },
      },
      // Real UI annotations, a few seconds apart.
      {
        _id: 'a-ui-1',
        taskId: 't-news',
        sampleId: 's-ui-1',
        userId: 'u-ann',
        label: '体育',
        fromLLM: false,
        status: 'approved',
        createdAt: at('2026-07-30T03:10:00Z'),
      },
      {
        _id: 'a-ui-2',
        taskId: 't-news',
        sampleId: 's-ui-2',
        userId: 'u-ann',
        label: '财经',
        fromLLM: false,
        createdAt: at('2026-07-30T03:10:04Z'),
      },
      // NER: the inflated span pattern from the real NER2 task ([10, 12) in a 9-char text).
      {
        _id: 'n-1',
        taskId: 't-ner',
        sampleId: 's-ner-1',
        userId: 'u-ann',
        fromLLM: false,
        status: 'approved',
        spans: [{ start: 10, end: 12, label: 'TIME', text: '岁月' }],
        createdAt: at('2026-04-17T10:04:00Z'),
      },
      {
        _id: 'n-2',
        taskId: 't-ner',
        sampleId: 's-ner-2',
        userId: 'u-ann',
        fromLLM: false,
        status: 'approved',
        spans: [
          { start: 0, end: 2, label: 'PER', text: '张伟' },
          { start: 20, end: 22, label: 'AGE', text: '四十' }, // not in the text at all
        ],
        createdAt: at('2026-04-17T10:05:00Z'),
      },
    ],
  };
}

let ctx: Context;
let report: MigrationReport;
beforeAll(async () => {
  ctx = await createContext(testConfig(), { inProcessTraining: true });
  report = await migrateV1(ctx.deps.db, await fixture(), {
    burstThreshold: 100,
    finalizeImported: true,
  });
});
afterAll(async () => ctx.close());

describe('pure helpers', () => {
  it('collapses sequence numbers into ranges', () => {
    expect(toRanges([5, 1, 2, 3, 9, 10])).toEqual([
      [1, 3],
      [5, 5],
      [9, 10],
    ]);
  });

  it('keeps good spans, repairs inflated ones, drops invented ones', () => {
    const counts = { spansChecked: 0, spansRepaired: 0, spansDropped: 0 };
    const spans = convertSpans(
      '张伟今年三十岁',
      [
        { start: 0, end: 2, label: 'PER', text: '张伟' },
        { start: 11, end: 13, label: 'AGE', text: '三十' },
        { start: 20, end: 22, label: 'AGE', text: '四十' },
      ],
      ['PER', 'AGE'],
      counts,
    );
    expect(spans).toEqual([
      { start: 0, end: 2, label: 'PER' },
      { start: 4, end: 6, label: 'AGE' },
    ]);
    expect(counts).toEqual({ spansChecked: 3, spansRepaired: 1, spansDropped: 1 });
  });
});

describe('migrating the fixture', () => {
  it('reports what it found', () => {
    expect(report).toMatchObject({
      users: 2,
      projects: 2,
      items: 124,
      humanReclassifiedAsImport: 120,
      duplicateDraftsDropped: 1,
      conflictingDuplicateDrafts: 1,
      platformConfidenceDropped: 1,
      spansRepaired: 1,
      spansDropped: 1,
      assignmentRanges: 1,
    });
    expect(report.annotations).toEqual({ human: 4, llm: 2, import: 120 });
  });

  it('turns bulk-written labels into final imported labels and keeps UI work human', async () => {
    const [news] = await ctx.deps.db.select().from(projects).where(eq(projects.name, 'TNEWS'));
    const rows = await ctx.deps.db
      .select()
      .from(items)
      .where(eq(items.projectId, news!.id))
      .orderBy(items.seq);
    expect(rows).toHaveLength(122);
    expect(rows[0]).toMatchObject({ seq: 1, finalSource: 'import', humanCount: 0 });
    const ui = rows.find((r) => r.text === '手工标注的一条')!;
    expect(ui).toMatchObject({ finalSource: 'consensus', finalLabel: '体育', humanCount: 1 });
    const range = await ctx.deps.db
      .select()
      .from(assignments)
      .where(eq(assignments.projectId, news!.id));
    expect(range.map((r) => [r.seqFrom, r.seqTo])).toEqual([[121, 122]]);
  });

  it('keeps the latest duplicate draft and only real confidences', async () => {
    const drafts = await ctx.deps.db
      .select()
      .from(annotations)
      .where(eq(annotations.source, 'llm'));
    const byModel = new Map(drafts.map((d) => [d.model, d]));
    expect(byModel.get('v1:unrecorded')).toMatchObject({ label: '财经', confidence: null });
    expect(byModel.get('v1:qwen3:14b')!.confidence).toBeCloseTo(0.97, 5);
  });

  it('repairs the inflated NER span onto its text', async () => {
    const [ner] = await ctx.deps.db.select().from(projects).where(eq(projects.name, 'NER2'));
    const [first] = await ctx.deps.db
      .select()
      .from(annotations)
      .innerJoin(items, eq(items.id, annotations.itemId))
      .where(and(eq(annotations.projectId, ner!.id), eq(items.seq, 1)));
    expect(first!.annotations.spans).toEqual([{ start: 2, end: 4, label: 'TIME' }]);
  });

  it('lets v1 users sign in with their old password', async () => {
    const client = new Client(createApp(ctx.deps));
    const login = await client.post('/api/auth/login', {
      username: 'employee1',
      password: 'v1-password',
    });
    expect(login.status).toBe(200);
    expect(login.body.role).toBe('annotator');
  });
});
