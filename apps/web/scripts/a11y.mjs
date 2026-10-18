/**
 * An accessibility scan of the main pages with axe-core, on a running demo instance:
 *
 *   DATA_DIR=./data/demo DEMO_MODE=true npm start      # after npm run seed:demo
 *   npm run a11y [-- --json a11y.json]
 *
 * Signs in through DEMO_MODE's one-click endpoint as whoever uses each page, opens it in
 * the light and the dark theme, and runs axe's WCAG 2.0, 2.1 and 2.2 A and AA rules. Prints
 * every violation with its impact and the number of elements it hits, and exits 1 if any
 * is serious or critical. Rules like these catch some problems, not all: this is a scan,
 * not an audit. Uses the installed Microsoft Edge (or Chrome with BROWSER=chrome).
 */
import { writeFile } from 'node:fs/promises';
import { AxeBuilder } from '@axe-core/playwright';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL ?? 'http://localhost:4000';
const channel = process.env.BROWSER === 'chrome' ? 'chrome' : 'msedge';
const jsonOut = process.argv.includes('--json')
  ? process.argv[process.argv.indexOf('--json') + 1]
  : null;
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const PAGES = [
  { name: 'sign-in', user: null, path: '/login' },
  { name: 'home', user: 'admin', path: '/' },
  { name: 'projects', user: 'admin', path: '/projects' },
  { name: 'overview', user: 'admin', path: '/projects/1' },
  { name: 'annotate', user: 'alice', path: '/projects/1/annotate' },
  { name: 'annotate-ner', user: 'chen', path: '/projects/3/annotate' },
  { name: 'review', user: 'rivera', path: '/projects/1/review' },
  { name: 'data', user: 'admin', path: '/projects/1/data' },
  { name: 'prelabel', user: 'admin', path: '/projects/1/llm' },
  { name: 'calibration', user: 'admin', path: '/projects/2/calibration' },
  { name: 'models', user: 'admin', path: '/projects/1/models' },
  { name: 'settings', user: 'admin', path: '/projects/1/settings' },
  { name: 'users', user: 'admin', path: '/users' },
  { name: 'account', user: 'alice', path: '/account' },
];

async function open(browser, { user, theme, path }) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: theme,
    locale: 'en-US',
  });
  await context.addInitScript((t) => {
    localStorage.setItem('cap.lang', 'en');
    localStorage.setItem('cap.theme', t);
  }, theme);
  if (user) {
    const res = await context.request.post(`${BASE}/api/auth/demo`, { data: { username: user } });
    if (!res.ok()) throw new Error(`demo sign-in as ${user}: ${res.status()} (is DEMO_MODE=true?)`);
  }
  const page = await context.newPage();
  await page.goto(`${BASE}${path}`);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(800);
  return { context, page };
}

const results = [];
const browser = await chromium.launch({ channel });
try {
  for (const target of PAGES) {
    for (const theme of ['light', 'dark']) {
      const { context, page } = await open(browser, { ...target, theme });
      const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      await context.close();
      results.push({
        page: target.name,
        theme,
        violations: violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          help: v.help,
          nodes: v.nodes.length,
          targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
        })),
      });
      const line = violations.length
        ? violations.map((v) => `${v.id} (${v.impact}, ${v.nodes.length})`).join(', ')
        : 'no violations';
      console.log(`${target.name.padEnd(13)} ${theme.padEnd(5)} ${line}`);
    }
  }
} finally {
  await browser.close();
}

const serious = results.flatMap((r) =>
  r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
);
console.log(
  `\n${results.length} page views, ${results.reduce((s, r) => s + r.violations.length, 0)} violations, ${serious.length} serious or critical`,
);
if (jsonOut) await writeFile(jsonOut, JSON.stringify(results, null, 2));
process.exit(serious.length ? 1 : 0);
