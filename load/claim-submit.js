/**
 * Annotators working flat out. Each virtual user signs in as an annotator of its own and
 * loops claim → submit until its queue is empty, taking each next claim from the submit
 * response, as the web app does. Two projects are worked at once: one where every item
 * goes to one person, one where it goes to two.
 *
 *   k6 run load/claim-submit.js                       # a fresh instance on :4000
 *   BASE_URL=… VUS=12 ITEMS=4000 k6 run load/claim-submit.js
 *
 * setup() creates the admin account (so the instance must be empty), the projects and the
 * annotators. Consensus is off, so every claim ends as a stored answer: a double claim
 * shows up in the database as one answer too many, which load/check.mjs counts afterwards.
 * Run that with the same DATABASE_URL as the server.
 */
import { check, fail, sleep } from 'k6';
import exec from 'k6/execution';
import http from 'k6/http';
import { Counter, Trend } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:4000';
const VUS = Number(__ENV.VUS || 12);
const ITEMS = Number(__ENV.ITEMS || 4000);
const PASSWORD = 'load-test-password';
const JSON_HEADERS = { 'content-type': 'application/json' };

const queueMs = new Trend('queue_ms', true);
const submitMs = new Trend('submit_ms', true);
const submitted = new Counter('submitted');

const annotators = (redundancy) => ({
  executor: 'per-vu-iterations',
  vus: VUS,
  iterations: 1,
  maxDuration: '10m',
  env: { REDUNDANCY: String(redundancy) },
});

export const options = {
  setupTimeout: '5m',
  scenarios: { one_each: annotators(1), two_each: annotators(2) },
  thresholds: {
    http_req_failed: ['rate==0'],
    checks: ['rate==1'],
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
};

function post(path, body, expected) {
  const res = http.post(`${BASE}${path}`, JSON.stringify(body), { headers: JSON_HEADERS });
  if (res.status !== expected) fail(`POST ${path}: ${res.status} ${res.body}`);
  return res;
}

export function setup() {
  post('/api/auth/setup', { username: 'admin', password: PASSWORD }, 201);
  const projects = {};
  for (const k of [1, 2]) {
    const project = post(
      '/api/projects',
      {
        name: `Load test, redundancy ${k}`,
        type: 'classification',
        labels: [
          { name: 'pos', color: '#1f9d63', hotkey: '1' },
          { name: 'neg', color: '#d9483b', hotkey: '2' },
        ],
        settings: { redundancy: k, autoFinalize: 'never' },
      },
      201,
    ).json();
    for (let start = 0; start < ITEMS; start += 5000) {
      const items = [];
      for (let i = start; i < Math.min(ITEMS, start + 5000); i++)
        items.push({ text: `Load test item ${i + 1} of project ${k}` });
      post(`/api/projects/${project.id}/items/batch`, { items }, 200);
    }
    projects[k] = project.id;
  }
  for (let i = 1; i <= 2 * VUS; i++)
    post('/api/users', { username: `annotator-${i}`, password: PASSWORD, role: 'annotator' }, 201);
  return { projects };
}

export default function (data) {
  const projectId = data.projects[__ENV.REDUNDANCY];
  post('/api/auth/login', { username: `annotator-${exec.vu.idInTest}`, password: PASSWORD }, 200);

  let claim = null;
  for (;;) {
    if (!claim) {
      const res = http.get(`${BASE}/api/projects/${projectId}/queue`);
      queueMs.add(res.timings.duration);
      if (!check(res, { 'queue answered': (r) => r.status === 200 })) {
        sleep(1);
        continue;
      }
      claim = res.json('claim');
      if (!claim) return; // nothing left for this annotator
    }
    const res = http.post(
      `${BASE}/api/projects/${projectId}/annotations/${claim.annotationId}/submit`,
      // Both annotators of an item give the same label.
      JSON.stringify({ label: claim.item.id % 2 ? 'pos' : 'neg', durationMs: 1500 }),
      { headers: JSON_HEADERS },
    );
    submitMs.add(res.timings.duration);
    if (check(res, { 'submit accepted': (r) => r.status === 200 })) {
      submitted.add(1);
      claim = res.json('next.claim');
    } else {
      claim = null; // ask the queue again; it resumes an open claim
    }
  }
}

const fmt = (ms) => (ms == null ? '–' : `${ms.toFixed(1)} ms`);

export function handleSummary(data) {
  const m = data.metrics;
  const seconds = data.state.testRunDurationMs / 1000;
  const lines = [
    `duration ${seconds.toFixed(1)} s, ${m.submitted?.values.count ?? 0} submits ` +
      `(${(m.submitted?.values.rate ?? 0).toFixed(1)}/s), ` +
      `failed requests ${((m.http_req_failed?.values.rate ?? 0) * 100).toFixed(2)}%`,
  ];
  for (const [name, label] of [
    ['submit_ms', 'submit + next claim'],
    ['queue_ms', 'queue'],
  ]) {
    const v = m[name]?.values;
    if (v)
      lines.push(
        `${label}: median ${fmt(v.med)}, p95 ${fmt(v['p(95)'])}, p99 ${fmt(v['p(99)'])}, max ${fmt(v.max)}`,
      );
  }
  return {
    stdout: `\n${lines.join('\n')}\n`,
    [__ENV.SUMMARY_JSON || 'k6-summary.json']: JSON.stringify(data, null, 2),
  };
}
