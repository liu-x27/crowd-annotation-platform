/**
 * Where the time went during load/claim-submit.js, from three places at once:
 *
 * - Postgres: pg_stat_statements (the server must preload it), per statement, and the
 *   plan auto_explain logged for the statement that took the most time;
 * - the server: load/pool-probe.mjs, preloaded into it, for waits on the pg pool and how
 *   busy its event loop was;
 * - the runner: CPU used by the Postgres container, by the server, and by the rest (k6).
 *
 *   node load/profile.mjs start              # just before k6: reset and take a first reading
 *   node load/profile.mjs report [summary]   # just after: print the difference
 *
 * Needs DATABASE_URL, SERVER_PID (the server's pid, for SIGUSR2 to the probe), and
 * PG_CONTAINER (the Postgres container, for its CPU and its log) if Postgres runs in Docker.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from 'pg';

const START_FILE = 'profile-start.json';
const PROBE_FILE = process.env.POOL_PROBE_FILE || 'pool-probe.json';
const TOP = 5;

/** Runner CPU from /proc/stat: busy and total ticks over all cores. */
function runnerTicks() {
  const [, ...fields] = readFileSync('/proc/stat', 'utf8').split('\n')[0].trim().split(/\s+/);
  const n = fields.map(Number);
  const total = n.reduce((a, b) => a + b, 0);
  return { busy: total - n[3] - n[4], total };
}

function containerCpuMicros() {
  if (!process.env.PG_CONTAINER) return null;
  try {
    const stat = execFileSync(
      'docker',
      ['exec', process.env.PG_CONTAINER, 'cat', '/sys/fs/cgroup/cpu.stat'],
      {
        encoding: 'utf8',
      },
    );
    return Number(/usage_usec (\d+)/.exec(stat)?.[1] ?? Number.NaN);
  } catch {
    return null;
  }
}

/** Ask the probe for a fresh reading and wait for it to land. */
async function probe() {
  const pid = Number(process.env.SERVER_PID);
  if (!pid || !existsSync(PROBE_FILE)) return null;
  const before = statSync(PROBE_FILE).mtimeMs;
  process.kill(pid, 'SIGUSR2');
  for (let i = 0; i < 40 && statSync(PROBE_FILE).mtimeMs === before; i++) await sleep(50);
  return JSON.parse(readFileSync(PROBE_FILE, 'utf8'));
}

async function reading() {
  return {
    at: Date.now(),
    runner: existsSync('/proc/stat') ? runnerTicks() : null,
    postgresCpuMicros: containerCpuMicros(),
    probe: await probe(),
  };
}

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

if (process.argv[2] === 'start') {
  await db.query('select pg_stat_statements_reset()');
  writeFileSync(START_FILE, JSON.stringify(await reading()));
  await db.end();
  process.exit(0);
}

const end = await reading();
const start = JSON.parse(readFileSync(START_FILE, 'utf8'));
const { rows: statements } = await db.query(`
  select calls::int, plans::int, total_exec_time as exec_ms, total_plan_time as plan_ms,
    rows::bigint, (shared_blks_hit + shared_blks_read)::float8 as blocks,
    -- Postgres 18 counts parallel workers per statement; older servers have no such column.
    coalesce((to_jsonb(s) ->> 'parallel_workers_launched')::int, 0) as workers, query
  from pg_stat_statements s
  where dbid = (select oid from pg_database where datname = current_database())
    and query not like '%pg_stat_statements%'
  order by total_exec_time desc`);
await db.end();

const summaryFile = process.argv[3] ?? 'k6-summary.json';
const submits = existsSync(summaryFile)
  ? (JSON.parse(readFileSync(summaryFile, 'utf8')).metrics.submitted?.values.count ?? 0)
  : 0;
const per = (x) => (submits ? x / submits : Number.NaN);
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '–');
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '–');
const pct = (x) => `${Math.round(x * 100)}%`;

const lines = [];
const wall = (end.at - start.at) / 1000;
const cores = cpus().length;
// Runners differ: two runs of one commit have made 178 and 266 submits a second.
const osName = existsSync('/etc/os-release')
  ? /^PRETTY_NAME="?([^"\n]*)/m.exec(readFileSync('/etc/os-release', 'utf8'))?.[1]
  : undefined;
const machine = [cpus()[0]?.model.trim(), osName].filter(Boolean).join(', ');
if (start.runner && end.runner) {
  const ticks = end.runner.total - start.runner.total;
  const busyCores = ((end.runner.busy - start.runner.busy) / ticks) * cores;
  const cpuSeconds = (micros) => micros / 1e6;
  const pgCores =
    start.postgresCpuMicros != null && end.postgresCpuMicros != null
      ? cpuSeconds(end.postgresCpuMicros - start.postgresCpuMicros) / wall
      : Number.NaN;
  const nodeCores =
    start.probe && end.probe
      ? cpuSeconds(
          end.probe.cpuMicros.user +
            end.probe.cpuMicros.system -
            start.probe.cpuMicros.user -
            start.probe.cpuMicros.system,
        ) / wall
      : Number.NaN;
  lines.push(
    `CPU over ${f1(wall)} s on ${cores} cores (${machine}): ${f2(busyCores)} cores busy on average — ` +
      `Postgres ${f2(pgCores)}, server ${f2(nodeCores)}, k6 and the rest ${f2(busyCores - pgCores - nodeCores)}`,
  );
}
if (start.probe && end.probe) {
  const a = start.probe;
  const b = end.probe;
  const loop =
    (b.eventLoop.active - a.eventLoop.active) /
    (b.eventLoop.active - a.eventLoop.active + b.eventLoop.idle - a.eventLoop.idle);
  lines.push(
    `Server: event loop busy ${pct(loop)} (delay p99 ${f1(b.eventLoop.delayP99Ms)} ms); ` +
      `pg pool: ${f1(per(b.checkouts - a.checkouts))} checkouts per submit, ` +
      `${f1(per(b.waitTotalMs - a.waitTotalMs))} ms waiting for a connection and ` +
      `${f1(per(b.holdTotalMs - a.holdTotalMs))} ms holding them per submit; ` +
      `wait p50 ${f2(b.waitP50Ms)}, p95 ${f1(b.waitP95Ms)}, p99 ${f1(b.waitP99Ms)} ms, ` +
      `up to ${b.maxWaiting} requests queued`,
  );
}

const execTotal = statements.reduce((s, r) => s + r.exec_ms, 0);
const planTotal = statements.reduce((s, r) => s + r.plan_ms, 0);
const callsTotal = statements.reduce((s, r) => s + r.calls, 0);
const plansTotal = statements.reduce((s, r) => s + r.plans, 0);
lines.push(
  `Postgres per submit: ${f2(per(execTotal))} ms executing and ${f2(per(planTotal))} ms planning ` +
    `over ${f1(per(callsTotal))} statements and ${f1(per(plansTotal))} plans ` +
    `(${submits} submits; all statements of the run, setup included)`,
);

/** Statement text, short enough to read: whitespace collapsed, no drizzle column lists. */
const short = (q) =>
  q
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^select (".+?) from "/, 'select … from "')
    .slice(0, 120);
const top = statements
  .slice(0, TOP)
  .map(
    (r, i) =>
      `#${i + 1} ${pct(r.exec_ms / execTotal)} of execution: ${r.calls} calls, ${r.plans} plans, ` +
      `${f2(r.exec_ms / r.calls)} ms mean (+${f2(r.plan_ms / r.calls)} planning), ` +
      `${Math.round(r.blocks / r.calls)} buffers a call` +
      (r.workers ? `, ${r.workers} parallel workers launched` : '') +
      `, ${f1(per(r.exec_ms))} ms per submit — ${short(r.query)}`,
  );

/** Text to compare a logged statement with pg_stat_statements' normalised one. */
const shape = (q) =>
  short(
    q
      .replace(/'[^']*'/g, '?')
      .replace(/\$\d+/g, '?')
      .replace(/\b\d+\b/g, '?'),
  ).slice(0, 80);

/**
 * Plans auto_explain logged to the Postgres container's output (the server must preload
 * it), for the statement that took the most time: the one with the median duration, of
 * the plans made for particular values and of the generic ones a prepared statement reuses
 * (those still have $n in them).
 */
function planOfTop() {
  if (!process.env.PG_CONTAINER || !statements.length) return null;
  const out = spawnSync('docker', ['logs', process.env.PG_CONTAINER], {
    encoding: 'utf8',
    maxBuffer: 512 << 20,
  });
  const want = shape(statements[0].query);
  const plans = [];
  // Continuation lines of a log entry start with a tab.
  for (const entry of `${out.stdout ?? ''}\n${out.stderr ?? ''}`.split(/\n(?=\S)/)) {
    const m = /duration: ([\d.]+) ms\s+plan:\n([\s\S]*)$/.exec(entry);
    if (!m) continue;
    const body = m[2].split('\n').map((l) => l.replace(/^\t/, ''));
    const start = body.findIndex((l) => l.includes('(cost='));
    if (start < 1) continue;
    const query = body
      .slice(0, start)
      .join('\n')
      .replace(/^Query Text:\s*/, '');
    if (shape(query) === want) plans.push({ ms: Number(m[1]), plan: body.slice(start).join('\n') });
  }
  return [
    ['made for its values', plans.filter((p) => !/\$\d/.test(p.plan))],
    ['generic', plans.filter((p) => /\$\d/.test(p.plan))],
  ]
    .filter(([, some]) => some.length)
    .map(([kind, some]) => {
      some.sort((a, b) => a.ms - b.ms);
      const median = some[Math.floor(some.length / 2)];
      return {
        title: `Plan of #1 ${kind}, the median of ${some.length} logged by auto_explain (${f1(median.ms)} ms)`,
        plan: median.plan,
      };
    });
}
const plans = planOfTop() ?? [];
for (const p of plans) console.log(`\n${p.title}:\n${p.plan}`);

for (const line of [...lines, ...top]) console.log(line);
if (process.env.GITHUB_ACTIONS) {
  // Workflow commands: a property ends at a comma, and a message at the end of the line.
  const data = (s) => s.replaceAll('%', '%25').replaceAll('\r', '').replaceAll('\n', '%0A');
  const property = (s) => data(s).replaceAll(':', '%3A').replaceAll(',', '%2C');
  const title = 'Where the time went (relative numbers; one runner for all three)';
  for (const line of [...lines, ...top]) console.log(`::notice title=${title}::${data(line)}`);
  for (const p of plans) console.log(`::notice title=${property(p.title)}::${data(p.plan)}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const table = statements
      .slice(0, 15)
      .map(
        (r) =>
          `| ${pct(r.exec_ms / execTotal)} | ${r.calls} | ${r.plans} | ${f2(r.exec_ms / r.calls)} | ` +
          `${f2(r.plan_ms / r.calls)} | ${Math.round(r.blocks / r.calls)} | ${r.workers} | ${r.rows} | ` +
          `\`${short(r.query).replaceAll('|', '\\|')}\` |`,
      );
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### ${title}\n\n${lines.map((l) => `- ${l}`).join('\n')}\n\n` +
        '| share | calls | plans | mean ms | plan ms | buffers | workers | rows | statement |\n' +
        '|---|---|---|---|---|---|---|---|---|\n' +
        `${table.join('\n')}\n` +
        plans.map((p) => `\n${p.title}:\n\n\`\`\`\n${p.plan}\n\`\`\`\n`).join(''),
    );
  }
}
