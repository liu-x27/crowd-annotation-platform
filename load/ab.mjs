/**
 * The k6 load test on two builds of the server, taking turns on one machine, so that both
 * are timed on the same CPU: runners differ enough (the same commit has made 178 and 266
 * submits a second on two of them) that runs on different ones cannot be compared.
 *
 *   PG_CONTAINER=… AB_BASE_DIR=../base node load/ab.mjs
 *
 * AB_BASE_DIR and AB_HEAD_DIR (default: here) are checkouts with `npm run build` done. Each
 * round runs both, base then head or head then base in turn (A B, B A, …), so a drift over
 * the job falls on both alike; AB_ROUNDS rounds (default 4). Every run gets a database of
 * its own on the Postgres at AB_POSTGRES_URL, a server on :4000 started without probes,
 * load/claim-submit.js and load/check.mjs from here, whichever build is being timed. CPU
 * per submit is read from the Postgres container's cgroup (PG_CONTAINER) and the server's
 * /proc entry, over the whole k6 run, setup included.
 *
 * Prints a line per run and the medians of each build, and in GitHub Actions writes them to
 * the job summary and as notices. Exits 1 if a run failed or a check found an item answered
 * the wrong number of times.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, openSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from 'pg';

const POSTGRES = process.env.AB_POSTGRES_URL || 'postgres://postgres:postgres@localhost:5432';
const ROUNDS = Number(process.env.AB_ROUNDS || 4);
const BUILDS = {
  base: path.resolve(process.env.AB_BASE_DIR || ''),
  head: path.resolve(process.env.AB_HEAD_DIR || '.'),
};
const PORT = 4000;
const TICKS = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }));

if (!process.env.AB_BASE_DIR) throw new Error('AB_BASE_DIR: the checkout to time against');
for (const dir of Object.values(BUILDS))
  if (!existsSync(path.join(dir, 'apps/server/dist/index.js')))
    throw new Error(`${dir}: no apps/server/dist/index.js; run npm run build there`);

const commit = (dir) =>
  execFileSync('git', ['-C', dir, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
const cpuModel = () =>
  /model name\s*:\s*(.+)/.exec(readFileSync('/proc/cpuinfo', 'utf8'))?.[1].trim() ?? 'unknown';

function postgresCpuMicros() {
  if (!process.env.PG_CONTAINER) return Number.NaN;
  const stat = execFileSync(
    'docker',
    ['exec', process.env.PG_CONTAINER, 'cat', '/sys/fs/cgroup/cpu.stat'],
    { encoding: 'utf8' },
  );
  return Number(/usage_usec (\d+)/.exec(stat)?.[1] ?? Number.NaN);
}

/** User and system CPU of a process so far, in ms. */
function processCpuMs(pid) {
  // Fields after the command name, which is in parentheses and may contain spaces.
  const fields = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
  return ((Number(fields[11]) + Number(fields[12])) / TICKS) * 1000;
}

async function admin(sql) {
  const db = new Client({ connectionString: `${POSTGRES}/postgres` });
  await db.connect();
  try {
    await db.query(sql);
  } finally {
    await db.end();
  }
}

async function healthy() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok) return;
    } catch {
      // not listening yet
    }
    await sleep(500);
  }
  throw new Error('the server did not come up');
}

async function run(build, round) {
  const tag = `${build}-${round}`;
  const database = `ab_${build}_${round}`;
  const url = `${POSTGRES}/${database}`;
  await admin(`create database ${database}`);

  const log = openSync(`ab-${tag}.log`, 'w');
  const server = spawn('node', [path.join(BUILDS[build], 'apps/server/dist/index.js')], {
    env: {
      ...process.env,
      DATABASE_URL: url,
      NODE_ENV: 'production',
      PORT: String(PORT),
      // Plain http on localhost: k6 would not send a Secure cookie back.
      COOKIE_SECURE: 'false',
    },
    stdio: ['ignore', log, log],
  });
  const exited = new Promise((resolve) => server.once('exit', resolve));
  try {
    await healthy();
    const before = { pg: postgresCpuMicros(), server: processCpuMs(server.pid) };
    const summary = `ab-${tag}.json`;
    const k6 = spawnSync('k6', ['run', '--quiet', 'load/claim-submit.js'], {
      env: { ...process.env, SUMMARY_JSON: summary },
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    const after = { pg: postgresCpuMicros(), server: processCpuMs(server.pid) };
    // check.mjs writes notices of its own in Actions; one line per run is enough here.
    const quiet = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => key !== 'GITHUB_ACTIONS'),
    );
    const check = spawnSync('node', ['load/check.mjs'], {
      env: { ...quiet, DATABASE_URL: url },
      encoding: 'utf8',
    });
    process.stdout.write(check.stdout);

    const { metrics } = JSON.parse(readFileSync(summary, 'utf8'));
    const submits = metrics.submitted?.values.count ?? 0;
    const submit = metrics.submit_ms?.values ?? {};
    return {
      build,
      round,
      ok: k6.status === 0 && check.status === 0,
      submits,
      rate: metrics.submitted?.values.rate ?? 0,
      median: submit.med,
      p95: submit['p(95)'],
      p99: submit['p(99)'],
      pgCpu: (after.pg - before.pg) / 1000 / submits,
      serverCpu: (after.server - before.server) / submits,
    };
  } finally {
    server.kill('SIGTERM');
    await Promise.race([exited, sleep(10_000).then(() => server.kill('SIGKILL'))]);
    await admin(`drop database ${database} with (force)`);
  }
}

const runs = [];
for (let round = 1; round <= ROUNDS; round++) {
  const order = round % 2 ? ['base', 'head'] : ['head', 'base'];
  for (const build of order) {
    const r = await run(build, round);
    runs.push(r);
    console.log(
      `round ${round} ${build}: ${r.rate.toFixed(1)} submits/s, median ${r.median?.toFixed(1)} ms, ` +
        `p99 ${r.p99?.toFixed(1)} ms, Postgres ${r.pgCpu.toFixed(2)} and server ` +
        `${r.serverCpu.toFixed(2)} ms CPU per submit${r.ok ? '' : ' — FAILED'}`,
    );
  }
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const of = (build, key) => runs.filter((r) => r.build === build).map((r) => r[key]);
const columns = [
  ['rate', 'submits/s', 1],
  ['median', 'median submit + next claim, ms', 1],
  ['p99', 'p99, ms', 1],
  ['pgCpu', 'Postgres CPU per submit, ms', 2],
  ['serverCpu', 'server CPU per submit, ms', 2],
];
const byRound = Array.from({ length: ROUNDS }, (_, i) => {
  const [b, h] = ['base', 'head'].map((x) => runs.find((r) => r.build === x && r.round === i + 1));
  return h.rate / b.rate;
});
const headFaster = byRound.filter((x) => x > 1).length;
const builds = `base ${commit(BUILDS.base)}, head ${commit(BUILDS.head)}`;
const lines = [
  `${builds}; ${ROUNDS} rounds each, alternating, on ${cpuModel()}`,
  ...columns.map(([key, label, digits]) => {
    const [b, h] = ['base', 'head'].map((x) => median(of(x, key)));
    return `${label}: base ${b.toFixed(digits)}, head ${h.toFixed(digits)} (${(((h - b) / b) * 100).toFixed(1)}%)`;
  }),
  `head/base submits a second, round by round: ${byRound.map((x) => x.toFixed(3)).join(', ')} ` +
    `(head faster in ${headFaster} of ${ROUNDS})`,
];
for (const line of lines) console.log(line);

const failed = runs.filter((r) => !r.ok);
if (process.env.GITHUB_ACTIONS) {
  for (const line of lines) console.log(`::notice title=Load A/B (medians of each build)::${line}`);
  if (failed.length)
    console.log(`::error title=Load A/B::${failed.length} run(s) failed or answered items wrongly`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const row = (cells) => `| ${cells.join(' | ')} |`;
    const table = [
      row(['round', 'build', ...columns.map(([, label]) => label), 'check']),
      row(Array(columns.length + 3).fill('---')),
      ...runs.map((r) =>
        row([
          r.round,
          r.build,
          ...columns.map(([key, , digits]) => r[key]?.toFixed(digits)),
          r.ok ? 'ok' : 'FAILED',
        ]),
      ),
    ];
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Load A/B\n\n${lines.map((l) => `- ${l}`).join('\n')}\n\n${table.join('\n')}\n`,
    );
  }
}
process.exit(failed.length ? 1 : 0);
