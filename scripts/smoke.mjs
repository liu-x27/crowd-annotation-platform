/**
 * Exercise a running instance over HTTP, the way its first users would.
 *
 *   node scripts/smoke.mjs http://127.0.0.1:4000           a fresh, empty instance
 *   node scripts/smoke.mjs http://127.0.0.1:4000 --again   the same instance after a restart
 *   node scripts/smoke.mjs http://127.0.0.1:4000 --demo    a DEMO_MODE instance with the demo
 *
 * Fresh: the web app is served; create the admin, a project and three items; claim and
 * submit one; export it. Again: that admin can still sign in and the answer is still in
 * the export. Demo: the sign-in page lists the demo accounts, one-click sign-in works, and
 * the demo's activity is recent.
 */
const [base, mode = '--fresh'] = process.argv.slice(2);
const PASSWORD = 'smoke-test-password';
let cookie = '';

async function call(method, path, body, expected = 200) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  // The session cookie is Secure in production; a script can send it back over http anyway.
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await res.text();
  if (res.status !== expected)
    throw new Error(
      `${method} ${path}: ${res.status}, expected ${expected}: ${text.slice(0, 300)}`,
    );
  return res.headers.get('content-type')?.startsWith('application/json') ? JSON.parse(text) : text;
}

function ok(condition, what) {
  if (!condition) throw new Error(`not ok - ${what}`);
  console.log(`ok - ${what}`);
}

const exported = async (projectId) =>
  (await call('GET', `/api/projects/${projectId}/export?format=jsonl&labels=final`))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));

const health = await call('GET', '/api/health');
ok(health.ok && health.db === 'pglite', `health: ${JSON.stringify(health)}`);

if (mode === '--fresh') {
  const page = await call('GET', '/');
  ok(typeof page === 'string' && page.includes('<div id="root">'), 'serves the web app');
  await call('POST', '/api/auth/setup', { username: 'smoke', password: PASSWORD }, 201);
  const project = await call(
    'POST',
    '/api/projects',
    {
      name: 'Smoke test',
      type: 'classification',
      labels: [
        { name: 'pos', color: '#1f9d63', hotkey: '1' },
        { name: 'neg', color: '#d9483b', hotkey: '2' },
      ],
    },
    201,
  );
  await call('POST', `/api/projects/${project.id}/items/batch`, {
    items: [{ text: 'A first sentence.' }, { text: 'A second one.' }, { text: 'And a third.' }],
  });
  const { claim } = await call('GET', `/api/projects/${project.id}/queue`);
  ok(claim?.item.seq === 1, 'claims the first item');
  const submitted = await call(
    'POST',
    `/api/projects/${project.id}/annotations/${claim.annotationId}/submit`,
    { label: 'pos' },
  );
  ok(submitted.finalized && submitted.next.claim?.item.seq === 2, 'submits it and claims the next');
  const rows = await exported(project.id);
  ok(rows.length === 1 && rows[0].label === 'pos', 'exports the answer');
} else if (mode === '--again') {
  await call('POST', '/api/auth/login', { username: 'smoke', password: PASSWORD });
  const projects = await call('GET', '/api/projects');
  const project = projects.find((p) => p.name === 'Smoke test');
  ok(project, 'the admin and the project survived the restart');
  const rows = await exported(project.id);
  ok(rows.length === 1 && rows[0].label === 'pos', 'and so did the answer');
} else if (mode === '--demo') {
  const state = await call('GET', '/api/auth/state');
  ok(state.demo?.length === 5, `lists the demo accounts: ${state.demo?.map((u) => u.username)}`);
  await call('POST', '/api/auth/demo', { username: 'alice' });
  const projects = await call('GET', '/api/projects');
  ok(projects.length === 3, 'signs in to a demo with three projects');
  const stats = await call('GET', '/api/me/stats');
  ok(stats.last7d > 0, `with recent activity: ${stats.last7d} answers in the last 7 days`);
} else {
  throw new Error(`unknown mode ${mode}`);
}
