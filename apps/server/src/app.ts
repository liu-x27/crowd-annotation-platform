import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { Hono, type MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import { loadUser } from './auth/middleware';
import type { Config } from './config';
import { type Db, openDatabase } from './db/client';
import type { UserRow } from './db/schema';
import { EventBus } from './events/bus';
import { JobRunner } from './jobs/runner';
import { AppError, forbidden } from './lib/errors';
import { authRoutes, meRoutes, userRoutes } from './modules/accounts/routes';
import { annotateRoutes } from './modules/annotate/routes';
import { insightRoutes } from './modules/insights/routes';
import { itemRoutes } from './modules/items/routes';
import { createPrelabelHandler } from './modules/llm/prelabel';
import { LlmRegistry } from './modules/llm/registry';
import type { LlmProvider } from './modules/llm/types';
import { projectRoutes } from './modules/projects/routes';
import { systemRoutes } from './modules/system/routes';
import { createTrainHandler } from './modules/training/job';
import { ModelStore } from './modules/training/store';

export interface Deps {
  db: Db;
  dbKind: 'pglite' | 'postgres';
  config: Config;
  bus: EventBus;
  jobs: JobRunner;
  llm: LlmRegistry;
  models: ModelStore;
}

export type AppEnv = { Variables: { deps: Deps; user?: UserRow } };

export interface Context {
  deps: Deps;
  close(): Promise<void>;
}

/** Everything the app needs, wired together. Used by the server, the scripts and the tests. */
export async function createContext(
  config: Config,
  opts: { inProcessTraining?: boolean; providers?: LlmProvider[]; llmConcurrency?: number } = {},
): Promise<Context> {
  const database = await openDatabase(config);
  const bus = new EventBus();
  const jobs = new JobRunner(database.db, bus);
  const llm = new LlmRegistry(config, opts.providers, opts.llmConcurrency);
  const models = new ModelStore(
    config.dataDir === ':memory:' ? null : path.join(config.dataDir, 'models'),
  );
  jobs.register('prelabel', createPrelabelHandler({ db: database.db, llm, bus }));
  jobs.register(
    'train',
    createTrainHandler({ db: database.db, models, inProcess: opts.inProcessTraining }),
  );
  return {
    deps: { db: database.db, dbKind: database.kind, config, bus, jobs, llm, models },
    async close() {
      await jobs.stop();
      bus.close();
      await database.close();
    },
  };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Cookie sessions plus SameSite=Lax already stop most cross-site writes; this closes the
 * rest by refusing state-changing requests whose Origin is neither this host nor trusted.
 */
function originCheck(config: Config): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!SAFE_METHODS.has(c.req.method)) {
      const origin = c.req.header('origin');
      if (origin && origin !== 'null') {
        let host: string | null = null;
        try {
          host = new URL(origin).host;
        } catch {
          host = null;
        }
        const sameHost = host != null && host === c.req.header('host');
        if (!sameHost && !config.trustedOrigins.includes(origin))
          throw forbidden('Cross-origin request rejected.');
      }
    }
    await next();
  };
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** Serve the built web app, falling back to index.html for client-side routes. */
function spa(webDist: string): MiddlewareHandler<AppEnv> {
  const root = path.resolve(webDist);
  return async (c, next) => {
    if (c.req.path.startsWith('/api/') || (c.req.method !== 'GET' && c.req.method !== 'HEAD'))
      return next();
    let file = path.resolve(root, `.${decodeURIComponent(c.req.path)}`);
    if (file !== root && !file.startsWith(root + path.sep)) return c.text('Not found', 404);
    let info = await stat(file).catch(() => null);
    if (!info || info.isDirectory()) {
      if (path.extname(file)) return c.text('Not found', 404);
      file = path.join(root, 'index.html');
      info = await stat(file).catch(() => null);
      if (!info) return next();
    }
    const hashed = file.includes(`${path.sep}assets${path.sep}`);
    return c.body(await readFile(file), 200, {
      'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
  };
}

export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>();

  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json(
        { error: { code: err.code, message: err.message, details: err.details } },
        err.status,
      );
    }
    if (err instanceof HTTPException) {
      return c.json({ error: { code: 'http_error', message: err.message } }, err.status);
    }
    console.error(`[${c.req.method} ${c.req.path}]`, err);
    return c.json(
      { error: { code: 'internal', message: 'Something went wrong on the server.' } },
      500,
    );
  });

  app.notFound((c) =>
    c.req.path.startsWith('/api/')
      ? c.json({ error: { code: 'not_found', message: 'No such endpoint.' } }, 404)
      : c.text('Not found', 404),
  );

  app.use('*', async (c, next) => {
    c.set('deps', deps);
    await next();
  });

  if (deps.config.env !== 'test') {
    app.use('/api/*', async (c, next) => {
      const started = performance.now();
      await next();
      if (c.req.path !== '/api/events') {
        console.log(
          `${c.req.method} ${c.req.path} ${c.res.status} ${Math.round(performance.now() - started)}ms`,
        );
      }
    });
  }

  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use('/api/*', originCheck(deps.config));
  app.use('/api/*', loadUser);

  app.get('/api/health', (c) => c.json({ ok: true, db: deps.dbKind }));
  app.route('/api/auth', authRoutes());
  app.route('/api/me', meRoutes());
  app.route('/api/users', userRoutes());
  app.route('/api/projects', projectRoutes());
  app.route('/api/projects/:id', annotateRoutes());
  app.route('/api/projects/:id', itemRoutes());
  app.route('/api/projects/:id', insightRoutes());
  app.route('/api', systemRoutes());

  app.use('*', spa(deps.config.webDist));
  return app;
}
