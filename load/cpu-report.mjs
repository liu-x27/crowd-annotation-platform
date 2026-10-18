/**
 * Where the server's CPU went during load/claim-submit.js, from the profile load/cpu-probe.mjs
 * took of its main thread: time per submit by where the code lives (a package, Node itself,
 * the app's bundle, the garbage collector), first as the time spent in that code itself, then
 * as the time that code was anywhere on the stack; and the functions behind both.
 *
 *   node load/cpu-report.mjs   # once k6 is done
 *
 * The profile stops at the server's next SIGUSR2; if load/profile.mjs has not sent one yet,
 * this sends it, to SERVER_PID. App frames are mapped back to their source with the bundle's
 * source map.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { SourceMap } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const PROFILE_FILE = process.env.CPU_PROFILE_FILE || 'server.cpuprofile';
const PROBE_FILE = process.env.CPU_PROBE_FILE || 'cpu-probe.json';
const TOP = 15;

if (!existsSync(PROBE_FILE) && process.env.SERVER_PID)
  process.kill(Number(process.env.SERVER_PID), 'SIGUSR2');
for (let i = 0; i < 200 && !existsSync(PROBE_FILE); i++) await sleep(50);
if (!existsSync(PROBE_FILE)) {
  console.log('No CPU profile: the probe never saw a submit, or did not stop.');
  process.exit(1);
}
const probe = JSON.parse(readFileSync(PROBE_FILE, 'utf8'));
const profile = JSON.parse(readFileSync(PROFILE_FILE, 'utf8'));
const submits = probe.requests.submit;

const SPECIAL = new Set(['(root)', '(idle)', '(program)', '(garbage collector)']);
// Below nearly every sample (the microtask loop, stream plumbing), so not shown as on the stack.
const SCAFFOLD = new Set(['Node.js', 'V8 builtins']);

/** Where a frame's code lives: a package, Node itself, the app, or V8. */
function home({ url, functionName }) {
  if (!url) return SPECIAL.has(functionName) ? functionName : 'V8 builtins';
  if (url.startsWith('node:')) return 'Node.js';
  if (url.startsWith('wasm:')) return 'WebAssembly';
  const pkg = /\/node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(url);
  if (pkg) return pkg[1];
  if (url.includes('/apps/server/dist/')) return 'app';
  if (url.includes('/load/')) return 'load probes';
  return url;
}

const maps = new Map();
/** file:line of a frame, through the source map for the app's bundle. */
function place({ url, lineNumber, columnNumber }) {
  if (!url) return '';
  if (url.includes('/apps/server/dist/') && url.startsWith('file:')) {
    if (!maps.has(url)) {
      const file = `${fileURLToPath(url)}.map`;
      maps.set(
        url,
        existsSync(file) ? new SourceMap(JSON.parse(readFileSync(file, 'utf8'))) : null,
      );
    }
    const entry = maps.get(url)?.findEntry(lineNumber, columnNumber);
    if (entry?.originalSource) {
      const source = resolve(dirname(fileURLToPath(url)), entry.originalSource);
      return `${relative(process.cwd(), source).replaceAll('\\', '/')}:${entry.originalLine + 1}`;
    }
  }
  const short = url
    .replace(/^.*\/node_modules\//, '')
    .replace(/^file:\/\/.*\/(apps|load)\//, '$1/');
  return `${short}:${lineNumber + 1}`;
}

const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const fnKey = (n) => `${n.callFrame.functionName || '(anonymous)'} ${place(n.callFrame)}`;

/** Each node's homes, and functions outside Node and V8, from it to the root, each once. */
const pathCache = new Map();
function path(id) {
  let hit = pathCache.get(id);
  if (hit) return hit;
  const n = nodes.get(id);
  const up = parent.has(id) ? path(parent.get(id)) : { homes: new Set(), fns: new Set() };
  const h = home(n.callFrame);
  hit = {
    homes: new Set(up.homes).add(h),
    fns: SCAFFOLD.has(h) || SPECIAL.has(h) ? up.fns : new Set(up.fns).add(fnKey(n)),
  };
  pathCache.set(id, hit);
  return hit;
}

// A sample lasts until the next one.
const { samples, timeDeltas } = profile;
const selfByHome = new Map();
const stackByHome = new Map();
const selfByFn = new Map();
const stackByFn = new Map();
const add = (map, key, us) => map.set(key, (map.get(key) ?? 0) + us);
let total = 0;
for (let i = 0; i < samples.length - 1; i++) {
  const us = timeDeltas[i + 1];
  const n = nodes.get(samples[i]);
  total += us;
  const h = home(n.callFrame);
  add(selfByHome, h, us);
  if (SPECIAL.has(h)) continue;
  add(selfByFn, fnKey(n), us);
  const p = path(samples[i]);
  for (const x of p.homes) if (!SPECIAL.has(x) && !SCAFFOLD.has(x)) add(stackByHome, x, us);
  for (const f of p.fns) add(stackByFn, f, us);
}

const idle = selfByHome.get('(idle)') ?? 0;
const busy = total - idle;
const ms = (us) => (submits ? us / 1000 / submits : Number.NaN).toFixed(2);
const pct = (x) => `${Math.round(x * 100)}%`;
const sorted = (map) => [...map].sort((a, b) => b[1] - a[1]);

const seconds = (probe.stoppedAt - probe.startedAt) / 1000;
const { queue, other } = probe.requests;
const head =
  `Main thread over ${seconds.toFixed(1)} s (${submits} submits, ${queue} queue reads, ` +
  `${other} other requests): busy ${pct(busy / total)}, ${ms(busy)} ms of CPU per submit`;
const selfLine = `Own time per submit, by where the code lives: ${sorted(selfByHome)
  .filter(([h]) => h !== '(idle)')
  .slice(0, 10)
  .map(([h, us]) => `${h} ${ms(us)} ms (${pct(us / busy)})`)
  .join(', ')}`;
const stackLine = `On the stack per submit (a frame anywhere below counts): ${sorted(stackByHome)
  .slice(0, 10)
  .map(([h, us]) => `${h} ${ms(us)} ms (${pct(us / busy)})`)
  .join(', ')}`;
const fnRows = (map) =>
  sorted(map)
    .slice(0, TOP)
    .map(([f, us]) => ({ f, ms: ms(us), share: pct(us / busy) }));
const selfFns = fnRows(selfByFn);
const stackFns = fnRows(stackByFn);
const list = (rows) => rows.map((r) => `${r.ms} ms (${r.share}) ${r.f}`).join('\n');

console.log(
  [
    head,
    selfLine,
    stackLine,
    `\nFunctions by own time:\n${list(selfFns)}`,
    `\nFunctions by time on the stack:\n${list(stackFns)}`,
  ].join('\n'),
);

if (process.env.GITHUB_ACTIONS) {
  const data = (s) => s.replaceAll('%', '%25').replaceAll('\r', '').replaceAll('\n', '%0A');
  const title = "Where the server's CPU went (V8 profile of its main thread; ms per submit)";
  for (const line of [head, selfLine, stackLine])
    console.log(`::notice title=${title}::${data(line)}`);
  console.log(`::notice title=${title}::${data(`Functions by own time:\n${list(selfFns)}`)}`);
  console.log(
    `::notice title=${title}::${data(`Functions by time on the stack:\n${list(stackFns)}`)}`,
  );
  if (process.env.GITHUB_STEP_SUMMARY) {
    const table = (rows) =>
      '| ms per submit | share of busy | function |\n|---|---|---|\n' +
      rows.map((r) => `| ${r.ms} | ${r.share} | \`${r.f.replaceAll('|', '\\|')}\` |`).join('\n');
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### ${title}\n\n- ${head}\n- ${selfLine}\n- ${stackLine}\n\n` +
        `Functions by own time:\n\n${table(selfFns)}\n\n` +
        `Functions by time on the stack:\n\n${table(stackFns)}\n\n` +
        `The profile is attached to the run as \`server-cpu-profile\` (open it in Chrome DevTools).\n`,
    );
  }
}
