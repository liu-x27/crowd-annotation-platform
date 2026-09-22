/**
 * Build a demo instance: three projects of synthetic text, simulated annotators and a
 * reviewer, LLM drafts, and trained student models.
 *
 *   npm run seed:demo -- [--llm auto|ollama|mock|none] [--model qwen3:4b] [--no-train]
 *
 * Everything about the annotators is simulated: each has a fixed accuracy against the label
 * the sentence was generated from, and copies the LLM draft some of the time when it is
 * shown — so the blind-audit panel has an effect to show. The drafts, however, come from a
 * real model when Ollama is available.
 */
import { parseArgs } from 'node:util';
import {
  type LabelDef,
  type LlmProviderId,
  type ProjectSettings,
  projectSettingsSchema,
  type Span,
} from '@crowd/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { createContext } from '../app';
import { loadConfig } from '../config';
import { rows } from '../db/client';
import { annotations, type ProjectRow, projects, type UserRow, users } from '../db/schema';
import { createUser } from '../modules/accounts/service';
import { claimNext, submitAnnotation } from '../modules/annotate/queue';
import { importBatch } from '../modules/items/service';
import { normalized } from '../modules/projects/access';
import { createProject } from '../modules/projects/service';
import { finalizeItem, rejectAnnotation, reviewQueue } from '../modules/review/service';
import {
  HEADLINE_GUIDELINES,
  HEADLINE_LABELS,
  headlines,
  NER_GUIDELINES,
  NER_LABELS,
  REVIEW_GUIDELINES,
  REVIEW_LABELS,
  resumes,
  reviews,
  seeded,
} from './demo/corpus';

const { values } = parseArgs({
  options: {
    llm: { type: 'string', default: 'auto' },
    model: { type: 'string' },
    'no-train': { type: 'boolean', default: false },
  },
});

export const DEMO_PASSWORD = 'demo-password';

const config = loadConfig();
const ctx = await createContext(config, { inProcessTraining: true });
const { db, jobs, llm } = ctx.deps;
const r = seeded(2026);

function labelDefs(
  defs: readonly { name: string; description: string }[],
  colors: string[],
): LabelDef[] {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  return defs.map((d, i) => ({
    name: d.name,
    description: d.description,
    color: colors[i]!,
    hotkey: keys[i] ?? null,
  }));
}

async function chooseLlm(): Promise<{ provider: LlmProviderId; model: string } | null> {
  if (values.llm === 'none') return null;
  if (values.llm === 'mock') return { provider: 'mock', model: 'mock' };
  const model = values.model ?? config.ollama.model;
  const info = await llm.get('ollama').describe();
  if (info.available && info.models.some((m) => m.name === model))
    return { provider: 'ollama', model };
  if (values.llm === 'ollama')
    throw new Error(
      `Ollama is not available with model ${model}: ${info.reason ?? 'model not pulled'}`,
    );
  console.warn(`Ollama/${model} not available, using the mock provider for drafts.`);
  return { provider: 'mock', model: 'mock' };
}

async function draftAll(project: ProjectRow, admin: UserRow) {
  const started = performance.now();
  const job = await jobs.enqueue({
    kind: 'prelabel',
    projectId: project.id,
    params: { scope: 'all' },
    createdBy: admin.id,
  });
  await jobs.idle();
  const done = await jobs.get(job.id);
  const secs = ((performance.now() - started) / 1000).toFixed(0);
  console.log(`  drafts: ${done.status} ${JSON.stringify(done.result)} in ${secs}s`);
}

const duration = (base: number, spread: number) => Math.round(base + Math.exp(r() * 2.3) * spread);

interface Persona {
  user: UserRow;
  accuracy: number;
  /** Chance of taking the draft as-is when it is on screen. */
  copyDraft: number;
  limit: number;
}

async function simulateClassification(
  project: ProjectRow,
  people: Persona[],
  truth: Map<string, { label: string; ambiguous: boolean }>,
) {
  const labels = project.labels.map((l) => l.name);
  const done = new Map<number, number>();
  while (people.some((p) => (done.get(p.user.id) ?? 0) < p.limit)) {
    let progressed = false;
    for (const p of people) {
      if ((done.get(p.user.id) ?? 0) >= p.limit) continue;
      const claim = await claimNext(db, project, p.user);
      if (!claim) continue;
      const t = truth.get(claim.item.text)!;
      let label: string;
      if (claim.draft?.label && r() < p.copyDraft) label = claim.draft.label;
      else if (r() < (t.ambiguous ? 0.6 : p.accuracy)) label = t.label;
      else label = labels.filter((l) => l !== t.label)[Math.floor(r() * (labels.length - 1))]!;
      await submitAnnotation(db, project, p.user, claim.annotationId, {
        label,
        durationMs: duration(1400, 800),
        flagged: t.ambiguous && r() < 0.35,
      });
      done.set(p.user.id, (done.get(p.user.id) ?? 0) + 1);
      progressed = true;
    }
    if (!progressed) break;
  }
}

async function simulateNer(project: ProjectRow, people: Persona[], truth: Map<string, Span[]>) {
  for (const p of people) {
    for (let i = 0; i < p.limit; i++) {
      const claim = await claimNext(db, project, p.user);
      if (!claim) break;
      const gold = truth.get(claim.item.text)!;
      let spans: Span[];
      if (claim.draft?.spans && r() < p.copyDraft) {
        spans = claim.draft.spans.map(({ start, end, label }) => ({ start, end, label }));
      } else {
        spans = [];
        for (const s of gold) {
          const x = r();
          if (x < p.accuracy) spans.push(s);
          else if (x < p.accuracy + (1 - p.accuracy) / 2 && s.end - s.start >= 3)
            spans.push({ ...s, end: s.end - 1 });
          // else: missed
        }
      }
      await submitAnnotation(db, project, p.user, claim.annotationId, {
        spans,
        durationMs: duration(5000, 2500),
      });
    }
  }
}

/** Spread simulated submissions over the last two weeks so the activity chart has a shape. */
async function spreadTimestamps(projectIds: number[]) {
  const rows = await db
    .select({ id: annotations.id })
    .from(annotations)
    .where(and(inArray(annotations.projectId, projectIds), eq(annotations.source, 'human')))
    .orderBy(annotations.id);
  const now = Date.now();
  for (let i = 0; i < rows.length; i++) {
    const progress = i / rows.length;
    const daysAgo = Math.max(0, 13 * (1 - progress) + (r() - 0.5) * 1.5);
    const at = new Date(now - daysAgo * 86_400_000 - r() * 3_600_000 * 6);
    await db
      .update(annotations)
      .set({ submittedAt: at, updatedAt: at, createdAt: at })
      .where(eq(annotations.id, rows[i]!.id));
  }
}

async function main() {
  const [existing] = await db.select({ id: users.id }).from(users).limit(1);
  if (existing) {
    console.error(
      `${config.dataDir} already has data. Seed into an empty DATA_DIR, e.g. DATA_DIR=./data-demo.`,
    );
    process.exit(1);
  }
  await jobs.start();
  const model = await chooseLlm();
  console.log(model ? `Drafting with ${model.provider}:${model.model}` : 'No LLM drafts');

  const admin = await createUser(db, {
    username: 'admin',
    password: DEMO_PASSWORD,
    role: 'admin',
    displayName: 'Demo Admin',
  });
  const rivera = await createUser(db, {
    username: 'rivera',
    password: DEMO_PASSWORD,
    role: 'reviewer',
    displayName: 'M. Rivera',
  });
  const alice = await createUser(db, {
    username: 'alice',
    password: DEMO_PASSWORD,
    role: 'annotator',
    displayName: 'Alice Chen',
  });
  const bob = await createUser(db, {
    username: 'bob',
    password: DEMO_PASSWORD,
    role: 'annotator',
    displayName: 'Bob Okafor',
  });
  const chen = await createUser(db, {
    username: 'chen',
    password: DEMO_PASSWORD,
    role: 'annotator',
    displayName: '陈晓',
  });

  const settings = (s: Partial<ProjectSettings>): ProjectSettings =>
    projectSettingsSchema.parse({
      ...s,
      llm: { provider: model?.provider ?? 'ollama', model: model?.model ?? '', fewShot: 3 },
    });

  // 1 ── Headlines: redundancy 2, blind audit on, disagreements reviewed.
  console.log('Project 1: headlines');
  const heads = headlines(240, r);
  let p1 = await createProject(
    db,
    {
      name: '新闻标题分类 · Headlines',
      description:
        'Chinese news headlines in five topics. Synthetic sentences generated for this demo.',
      type: 'classification',
      labels: labelDefs(HEADLINE_LABELS, ['#3b6fe0', '#1f9d63', '#8250df', '#d0418d', '#d4861b']),
      guidelines: HEADLINE_GUIDELINES,
      settings: settings({ redundancy: 2, blindRate: 0.25, draftMode: 'suggest' }),
    },
    admin.id,
  );
  p1 = normalized(p1);
  await importBatch(db, p1, {
    items: heads.map((h) => ({ text: h.text })),
    dedupe: true,
    unknownLabels: 'error',
    finalizeImported: false,
  });
  if (model) await draftAll(p1, admin);
  await simulateClassification(
    p1,
    [
      { user: alice, accuracy: 0.95, copyDraft: 0.2, limit: 190 },
      { user: bob, accuracy: 0.86, copyDraft: 0.45, limit: 185 },
      { user: chen, accuracy: 0.9, copyDraft: 0.25, limit: 30 },
    ],
    new Map(heads.map((h) => [h.text, h])),
  );
  const queue = await reviewQueue(db, p1, { filter: 'all', limit: 50, offset: 0 });
  let reviewed = 0;
  for (const entry of queue.entries) {
    if (reviewed >= Math.floor(queue.entries.length * 0.6)) break;
    const truth = heads.find((h) => h.text === entry.item.text)!;
    await finalizeItem(db, p1, rivera, entry.item.id, { label: truth.label });
    reviewed++;
  }
  const bobs = queue.entries
    .slice(reviewed)
    .flatMap((e) => e.human.filter((a) => a.user?.id === bob.id && a.status === 'submitted'));
  if (bobs[0])
    await rejectAnnotation(
      db,
      p1,
      rivera,
      bobs[0].id,
      '“冠名赛事”按指南归财经，请再看一下第一条规则。',
    );
  console.log(`  review: ${queue.total} in queue, ${reviewed} finalised, 1 returned`);

  // 2 ── Reviews: redundancy 1, draft preselected.
  console.log('Project 2: reviews');
  const revs = reviews(180, r);
  let p2 = await createProject(
    db,
    {
      name: 'Product review sentiment',
      description:
        'English product reviews, three-way sentiment. Synthetic sentences generated for this demo.',
      type: 'classification',
      labels: labelDefs(REVIEW_LABELS, ['#1f9d63', '#d9483b', '#6b7280']),
      guidelines: REVIEW_GUIDELINES,
      settings: settings({ redundancy: 1, blindRate: 0.2, draftMode: 'preselect' }),
    },
    admin.id,
  );
  p2 = normalized(p2);
  await importBatch(db, p2, {
    items: revs.map((x) => ({ text: x.text })),
    dedupe: true,
    unknownLabels: 'error',
    finalizeImported: false,
  });
  if (model) await draftAll(p2, admin);
  await simulateClassification(
    p2,
    [
      { user: alice, accuracy: 0.93, copyDraft: 0.3, limit: 60 },
      { user: bob, accuracy: 0.84, copyDraft: 0.6, limit: 55 },
      { user: chen, accuracy: 0.9, copyDraft: 0.35, limit: 40 },
    ],
    new Map(revs.map((x) => [x.text, x])),
  );

  // 3 ── Résumé NER.
  console.log('Project 3: NER');
  const cvs = resumes(90, r);
  let p3 = await createProject(
    db,
    {
      name: '简历实体识别 · Résumé NER',
      description:
        'Entities in Chinese résumé sentences. Synthetic sentences generated for this demo.',
      type: 'ner',
      labels: labelDefs(NER_LABELS, ['#3b6fe0', '#8250df', '#1f9d63', '#d4861b']),
      guidelines: NER_GUIDELINES,
      settings: settings({ redundancy: 1, draftMode: 'suggest' }),
    },
    admin.id,
  );
  p3 = normalized(p3);
  await importBatch(db, p3, {
    items: cvs.map((x) => ({ text: x.text })),
    dedupe: true,
    unknownLabels: 'error',
    finalizeImported: false,
  });
  if (model) await draftAll(p3, admin);
  await simulateNer(
    p3,
    [
      { user: chen, accuracy: 0.9, copyDraft: 0.3, limit: 55 },
      { user: alice, accuracy: 0.94, copyDraft: 0.2, limit: 12 },
    ],
    new Map(cvs.map((x) => [x.text, x.spans])),
  );

  await spreadTimestamps([p1.id, p2.id, p3.id]);

  if (!values['no-train']) {
    console.log('Training student models');
    for (const [p, source] of [
      [p1, 'final'],
      [p1, 'llm'],
      [p2, 'final'],
      [p3, 'final'],
    ] as const) {
      const job = await jobs.enqueue({
        kind: 'train',
        projectId: p.id,
        params: { source, epochs: 15 },
        createdBy: admin.id,
      });
      await jobs.idle();
      const done = await jobs.get(job.id);
      console.log(`  ${p.name} (${source}): ${done.status}${done.error ? ` — ${done.error}` : ''}`);
    }
  }

  const [{ n } = { n: 0 }] = await rows<{ n: number }>(
    db,
    sql`select count(*)::int as n from annotations`,
  );
  const count = await db.select({ id: projects.id }).from(projects);
  console.log(`\nDone: ${count.length} projects, ${n} annotations in ${config.dataDir}`);
  console.log(
    `Sign in with any of admin / rivera / alice / bob / chen, password "${DEMO_PASSWORD}".`,
  );
}

try {
  await main();
} finally {
  await ctx.close();
}
