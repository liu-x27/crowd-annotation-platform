/**
 * Screenshots for the README, taken from a running demo instance:
 *
 *   DATA_DIR=./data/demo DEMO_MODE=true npm start      # after npm run seed:demo
 *   npm run screenshots
 *
 * Uses the installed Microsoft Edge (or Chrome with BROWSER=chrome) through playwright-core,
 * so no browser download is needed. Signs in through DEMO_MODE's one-click endpoint.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL ?? 'http://localhost:4000';
const OUT = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const channel = process.env.BROWSER === 'chrome' ? 'chrome' : 'msedge';
const only = process.argv.slice(2);

async function session(
  browser,
  { user, lang = 'en', theme = 'light', viewport = { width: 1440, height: 900 } },
) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    colorScheme: theme,
    locale: lang === 'zh' ? 'zh-CN' : 'en-US',
  });
  await context.addInitScript(
    ([l, t]) => {
      localStorage.setItem('cap.lang', l);
      localStorage.setItem('cap.theme', t);
      localStorage.setItem('cap.panel', 'guidelines');
    },
    [lang, theme],
  );
  if (user) {
    const res = await context.request.post(`${BASE}/api/auth/demo`, { data: { username: user } });
    if (!res.ok())
      throw new Error(`demo login as ${user} failed: ${res.status()} (is DEMO_MODE=true?)`);
  }
  return context;
}

async function settle(page, ms = 700) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(ms);
}

const shots = [
  {
    name: 'login',
    run: async (b) => {
      const ctx = await session(b, {});
      const page = await ctx.newPage();
      await page.goto(`${BASE}/login`);
      await page.waitForTimeout(6600); // the hero loop reaches its summary step (5.4–8.6 s)
      return { page, ctx };
    },
  },
  {
    name: 'overview',
    full: true,
    run: async (b) => {
      const ctx = await session(b, { user: 'admin' });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/projects/1`);
      await page.getByText('Inter-annotator agreement').waitFor();
      await settle(page, 1200);
      return { page, ctx };
    },
  },
  {
    name: 'annotate',
    run: async (b) => {
      // An annotator whose next claim shows the draft (a blind-audit claim would hide it).
      const ctx = await session(b, { user: 'alice' });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/projects/1/annotate`);
      await page.getByText('Flag for review').or(page.getByText('All done')).first().waitFor();
      await settle(page);
      return { page, ctx };
    },
  },
  {
    name: 'annotate-ner',
    run: async (b) => {
      const ctx = await session(b, { user: 'chen' });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/projects/3/annotate`);
      await page.getByText('Entities').first().waitFor();
      await settle(page);
      return { page, ctx };
    },
  },
  {
    name: 'review',
    run: async (b) => {
      const ctx = await session(b, { user: 'rivera' });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/projects/1/review`);
      await page.getByText('Answers').waitFor();
      await settle(page);
      return { page, ctx };
    },
  },
  {
    name: 'data',
    run: async (b) => {
      const ctx = await session(b, { user: 'admin' });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/projects/1/data?disagreement=1`);
      await page.locator('main tbody tr').first().waitFor();
      await settle(page, 400);
      await page.locator('main tbody tr').first().click();
      await page.getByText('Everything recorded for this item').waitFor();
      await page.getByText('Raw model output').first().click();
      await settle(page, 500);
      return { page, ctx };
    },
  },
  {
    name: 'prelabel',
    full: true,
    run: async (b) => {
      const ctx = await session(b, { user: 'admin' });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/projects/1/llm`);
      await page.getByText('How good are the drafts?').waitFor();
      await page.getByRole('button', { name: 'Run', exact: true }).click();
      await page.getByText('Raw reply').first().waitFor({ timeout: 120_000 });
      await settle(page, 600);
      return { page, ctx };
    },
  },
  {
    name: 'models',
    full: true,
    run: async (b) => {
      const ctx = await session(b, { user: 'admin' });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/projects/1/models`);
      await page.getByText('Training curves').waitFor();
      await settle(page, 900);
      return { page, ctx };
    },
  },
  {
    name: 'overview-dark-zh',
    run: async (b) => {
      const ctx = await session(b, { user: 'admin', lang: 'zh', theme: 'dark' });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/projects/1`);
      await page.getByText('标注员间一致性').waitFor();
      await settle(page, 1200);
      return { page, ctx };
    },
  },
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ channel });
try {
  for (const shot of shots) {
    if (only.length && !only.includes(shot.name)) continue;
    const started = Date.now();
    const { page, ctx } = await shot.run(browser);
    const file = path.join(OUT, `${shot.name}.png`);
    if (shot.full) {
      // Grow the viewport to the page rather than stitching, so 100vh elements (the sidebar)
      // span the whole image.
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      await page.setViewportSize({ width: page.viewportSize().width, height });
      await page.waitForTimeout(500);
    }
    await page.screenshot({ path: file, animations: 'disabled' });
    await ctx.close();
    console.log(`${shot.name}.png  ${Date.now() - started} ms`);
  }
} finally {
  await browser.close();
}
