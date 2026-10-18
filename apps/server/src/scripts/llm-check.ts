/**
 * Draft a dozen labelled sentences through one provider, the way a pre-labelling job does,
 * and say what came back: how many drafts parsed, how many matched the sentence's label,
 * what failed and why, and how long the calls took.
 *
 *   npm run llm:check -- --provider anthropic --model claude-opus-5
 *   npm run llm:check -- --provider openai --model qwen3:4b
 *   npm run llm:check -- --provider ollama --model qwen3:4b [--n 12]
 *
 * Uses the provider settings from .env (ANTHROPIC_*, OPENAI_*, OLLAMA_*) and prints no
 * keys. Runs on an in-memory database: nothing is written to DATA_DIR. The sentences are
 * the demo's synthetic product reviews, so a match rate says the wiring works, not how good
 * the model is.
 */
import { parseArgs } from 'node:util';
import { LLM_PROVIDERS, type LlmProviderId, projectSettingsSchema } from '@crowd/shared';
import { and, eq } from 'drizzle-orm';
import { createContext } from '../app';
import { loadConfig } from '../config';
import { annotations, items } from '../db/schema';
import { createUser } from '../modules/accounts/service';
import { importBatch } from '../modules/items/service';
import { normalized } from '../modules/projects/access';
import { createProject } from '../modules/projects/service';
import { REVIEW_GUIDELINES, REVIEW_LABELS, reviews, seeded } from './demo/corpus';

const { values } = parseArgs({
  options: {
    provider: { type: 'string' },
    model: { type: 'string', default: '' },
    n: { type: 'string', default: '12' },
  },
});
const provider = values.provider as LlmProviderId;
if (!LLM_PROVIDERS.includes(provider)) {
  console.error(`--provider must be one of ${LLM_PROVIDERS.join(', ')}`);
  process.exit(2);
}

const ctx = await createContext(
  { ...loadConfig(), dataDir: ':memory:', databaseUrl: null },
  { inProcessTraining: true },
);
const { db, jobs, llm } = ctx.deps;
try {
  const info = await llm.get(provider).describe();
  console.log(`${provider}: ${info.available ? 'available' : 'not available'}`);
  if (info.reason) console.log(`  ${info.reason}`);
  if (!info.available) process.exit(1);

  const admin = await createUser(db, {
    username: 'check',
    password: 'llm-check-only',
    role: 'admin',
  });
  const sentences = reviews(Number(values.n), seeded(17));
  const project = normalized(
    await createProject(
      db,
      {
        name: 'LLM check',
        type: 'classification',
        labels: REVIEW_LABELS.map((l, i) => ({
          name: l.name,
          description: l.description,
          color: ['#1f9d63', '#d9483b', '#6b7280'][i]!,
          hotkey: String(i + 1),
        })),
        guidelines: REVIEW_GUIDELINES,
        settings: projectSettingsSchema.parse({
          llm: { provider, model: values.model, fewShot: 0 },
        }),
      },
      admin.id,
    ),
  );
  await importBatch(db, project, {
    items: sentences.map((s) => ({ text: s.text })),
    dedupe: true,
    unknownLabels: 'error',
    finalizeImported: false,
  });
  await jobs.start();
  const job = await jobs.enqueue({
    kind: 'prelabel',
    projectId: project.id,
    params: { scope: 'all' },
    createdBy: admin.id,
  });
  await jobs.idle();
  const done = await jobs.get(job.id);
  console.log(`job: ${done.status}${done.error ? ` (${done.error})` : ''}`);

  const drafts = await db
    .select({ a: annotations, text: items.text })
    .from(annotations)
    .innerJoin(items, eq(items.id, annotations.itemId))
    .where(and(eq(annotations.projectId, project.id), eq(annotations.source, 'llm')));
  const truth = new Map(sentences.map((s) => [s.text, s.label]));
  const parsed = drafts.filter((d) => d.a.status === 'submitted');
  const matched = parsed.filter((d) => d.a.label === truth.get(d.text));
  const latency = drafts.map((d) => d.a.latencyMs ?? 0).sort((x, y) => x - y);
  console.log(
    `${drafts.length} drafts: ${parsed.length} parsed, ${drafts.length - parsed.length} failed; ` +
      `${matched.length} of ${parsed.length} match the sentence's label`,
  );
  console.log(
    `model reported: ${[...new Set(drafts.map((d) => d.a.model))].join(', ')}; ` +
      `latency median ${latency[Math.floor(latency.length / 2)] ?? '–'} ms, max ${latency.at(-1) ?? '–'} ms`,
  );
  for (const d of drafts.filter((x) => x.a.status !== 'submitted').slice(0, 3))
    console.log(`  failed: ${d.a.error}`);
  for (const d of drafts.slice(0, 3))
    console.log(`  raw: ${(d.a.rawOutput ?? '').replace(/\s+/g, ' ').slice(0, 160)}`);
} finally {
  await ctx.close();
}
