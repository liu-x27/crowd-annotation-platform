/**
 * After load/claim-submit.js: ask the database whether every item was answered exactly as
 * many times as its project's redundancy asks — no item handed out twice, none lost — and
 * whether each item's human_count still agrees with its stored answers. Exits 1 if not.
 *
 *   DATABASE_URL=… node load/check.mjs [k6-summary.json]
 *
 * In GitHub Actions it also writes the result to the job summary, and as notices that can
 * be read from the run's annotations without downloading its logs.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { Client } from 'pg';

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const { rows: projects } = await db.query(`
  with per_item as (
    select i.project_id, i.id, i.human_count,
           count(a.id) filter (where a.status = 'submitted')::int as answers,
           count(a.id) filter (where a.status = 'claimed')::int as open_claims
    from items i
    left join annotations a on a.item_id = i.id and a.source = 'human'
    group by i.id
  )
  select p.id, p.name, (p.settings->>'redundancy')::int as k,
         count(x.id)::int as items,
         coalesce(sum(x.answers), 0)::int as answers,
         count(x.id) filter (where x.answers > (p.settings->>'redundancy')::int)::int as over,
         count(x.id) filter (where x.answers < (p.settings->>'redundancy')::int)::int as under,
         coalesce(sum(x.open_claims), 0)::int as open_claims,
         count(x.id) filter (where x.human_count <> x.answers)::int as count_drift
  from projects p
  left join per_item x on x.project_id = p.id
  group by p.id
  order by p.id`);
await db.end();

const failures = projects.filter((p) => p.over || p.under || p.open_claims || p.count_drift);
const lines = projects.map(
  (p) =>
    `${p.name}: ${p.items} items × ${p.k} = ${p.items * p.k} answers expected, ${p.answers} stored; ` +
    `${p.over} items answered more than ${p.k}×, ${p.under} fewer, ${p.open_claims} claims left open, ` +
    `${p.count_drift} items whose human_count disagrees`,
);

let k6 = null;
const summaryFile = process.argv[2];
if (summaryFile && existsSync(summaryFile)) {
  const { metrics, state } = JSON.parse(readFileSync(summaryFile, 'utf8'));
  const t = (name) => metrics[name]?.values ?? {};
  const ms = (v) => (v == null ? '–' : `${v.toFixed(1)} ms`);
  const submit = t('submit_ms');
  k6 =
    `k6: ${t('submitted').count ?? 0} submits in ${(state.testRunDurationMs / 1000).toFixed(1)} s ` +
    `(${(t('submitted').rate ?? 0).toFixed(1)}/s); submit + next claim median ${ms(submit.med)}, ` +
    `p95 ${ms(submit['p(95)'])}, p99 ${ms(submit['p(99)'])}; ` +
    `failed requests ${((t('http_req_failed').rate ?? 0) * 100).toFixed(2)}%`;
}

for (const line of [...lines, k6].filter(Boolean)) console.log(line);

if (process.env.GITHUB_ACTIONS) {
  const verdict = failures.length
    ? `FAILED: ${failures.length} project(s) with items answered the wrong number of times`
    : 'every item answered exactly redundancy times; nothing handed out twice';
  console.log(`::${failures.length ? 'error' : 'notice'} title=Claims after load::${verdict}`);
  for (const line of lines) console.log(`::notice title=Claims after load::${line}`);
  if (k6) console.log(`::notice title=k6 (relative numbers; one runner for all three)::${k6}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Claims after the load run\n\n${verdict}\n\n${lines.map((l) => `- ${l}`).join('\n')}\n\n` +
        (k6
          ? `${k6}\n\nk6, the server and Postgres share one runner; read these as relative numbers.\n`
          : ''),
    );
  }
}

process.exit(failures.length ? 1 : 0);
