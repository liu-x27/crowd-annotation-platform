import { existsSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { createApp, createContext } from './app';
import { purgeExpiredSessions } from './auth/sessions';
import { loadConfig } from './config';

const config = loadConfig();
const context = await createContext(config);
const { deps } = context;
await deps.jobs.start();
await purgeExpiredSessions(deps.db);
const purge = setInterval(
  () => void purgeExpiredSessions(deps.db).catch(() => undefined),
  3_600_000,
);

const app = createApp(deps);
const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  const where =
    deps.dbKind === 'postgres' ? 'Postgres (DATABASE_URL)' : `embedded PGlite in ${config.dataDir}`;
  console.log(`API listening on http://${info.address}:${info.port}  ·  database: ${where}`);
  if (existsSync(config.webDist)) console.log(`Serving the web app from ${config.webDist}`);
  else console.log('Web app not built; run the Vite dev server (npm run dev) or npm run build.');
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal}: shutting down…`);
  clearInterval(purge);
  server.close();
  await context.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
