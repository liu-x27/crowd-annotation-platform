import { randomBytes } from 'node:crypto';
import type { CreateProjectInput, LabelDefInput, Me, ProjectDTO, Role } from '@crowd/shared';
import { labelsFromNames } from '@crowd/shared';
import { inject } from 'vitest';
import { type Context, createApp, createContext, type Deps } from '../app';
import { type Config, testConfig } from '../config';
import { adminQuery, withDatabase } from './pg-admin';

/**
 * A database of its own for one test context. Without TEST_DATABASE_URL that is a fresh
 * in-memory PGlite (`url` null). With it, a copy of the template global-setup.ts migrated
 * on that server: copying takes milliseconds where migrating takes seconds, and the files
 * vitest runs in parallel never see each other's rows.
 */
export async function testDatabase(): Promise<{ url: string | null; drop(): Promise<void> }> {
  const server = process.env.TEST_DATABASE_URL;
  if (!server) return { url: null, drop: async () => {} };
  const template = inject('pgTemplate');
  const name = `${template}_${randomBytes(4).toString('hex')}`;
  await adminQuery(server, `create database "${name}" template "${template}"`);
  return {
    url: withDatabase(server, name),
    drop: async () => {
      await adminQuery(server, `drop database if exists "${name}" with (force)`);
    },
  };
}

/** `createContext` on the test configuration and a database of its own, dropped on close. */
export async function testContext(
  overrides: Partial<Config> = {},
  opts?: Parameters<typeof createContext>[1],
): Promise<Context & { databaseUrl: string | null }> {
  const database = await testDatabase();
  const ctx = await createContext(testConfig({ databaseUrl: database.url, ...overrides }), opts);
  return {
    deps: ctx.deps,
    databaseUrl: database.url,
    async close() {
      await ctx.close();
      await database.drop();
    },
  };
}

export interface Response<T = any> {
  status: number;
  body: T;
  headers: Headers;
  text: string;
}

/** A logged-in (or anonymous) API client that carries its session cookie. */
export class Client {
  cookie: string | null = null;

  constructor(private readonly app: ReturnType<typeof createApp>) {}

  async req<T = any>(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<Response<T>> {
    const res = await this.app.request(path, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const pair = setCookie.split(';')[0]!;
      this.cookie = pair.endsWith('=') ? null : pair;
    }
    // Decode by hand: Response.text() strips a leading BOM, and exports are meant to keep one.
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await res.arrayBuffer());
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // not JSON (exports)
    }
    return { status: res.status, body: parsed as T, headers: res.headers, text };
  }

  get<T = any>(path: string) {
    return this.req<T>('GET', path);
  }
  post<T = any>(path: string, body: unknown = {}) {
    return this.req<T>('POST', path, body);
  }
  put<T = any>(path: string, body: unknown = {}) {
    return this.req<T>('PUT', path, body);
  }
  patch<T = any>(path: string, body: unknown = {}) {
    return this.req<T>('PATCH', path, body);
  }
  del<T = any>(path: string) {
    return this.req<T>('DELETE', path);
  }
}

export interface Harness {
  deps: Deps;
  /** The Postgres server database behind `deps.db`; null on PGlite. */
  databaseUrl: string | null;
  app: ReturnType<typeof createApp>;
  admin: Client;
  anon(): Client;
  user(username: string, role?: Role): Promise<Client & { me: Me }>;
  project(input: ProjectInput, texts?: string[]): Promise<ProjectDTO>;
  close(): Promise<void>;
}

export const PASSWORD = 'correct horse battery';

/** Project input for tests: labels may be bare names. */
export type ProjectInput = Omit<Partial<CreateProjectInput>, 'labels' | 'settings'> & {
  labels?: string[] | LabelDefInput[];
  settings?: Record<string, unknown>;
};

export async function harness(overrides: Partial<Config> = {}): Promise<Harness> {
  const ctx = await testContext(overrides, { inProcessTraining: true, llmConcurrency: 2 });
  await ctx.deps.jobs.start();
  const app = createApp(ctx.deps);
  const admin = new Client(app);
  const setup = await admin.post('/api/auth/setup', { username: 'admin', password: PASSWORD });
  if (setup.status !== 201) throw new Error(`setup failed: ${setup.text}`);

  return {
    deps: ctx.deps,
    databaseUrl: ctx.databaseUrl,
    app,
    admin,
    anon: () => new Client(app),
    async user(username, role = 'annotator') {
      const created = await admin.post('/api/users', { username, password: PASSWORD, role });
      if (created.status !== 201) throw new Error(`create user failed: ${created.text}`);
      const client = new Client(app) as Client & { me: Me };
      const login = await client.post('/api/auth/login', { username, password: PASSWORD });
      if (login.status !== 200) throw new Error(`login failed: ${login.text}`);
      client.me = login.body;
      return client;
    },
    async project(input, texts = []) {
      const labels = input.labels ?? ['pos', 'neg'];
      const res = await admin.post('/api/projects', {
        name: 'Test project',
        type: 'classification',
        ...input,
        labels: typeof labels[0] === 'string' ? labelsFromNames(labels as string[]) : labels,
      });
      if (res.status !== 201) throw new Error(`create project failed: ${res.text}`);
      if (texts.length) {
        const imp = await admin.post(`/api/projects/${res.body.id}/items/batch`, {
          items: texts.map((text) => ({ text })),
        });
        if (imp.status !== 200) throw new Error(`import failed: ${imp.text}`);
      }
      return res.body as ProjectDTO;
    },
    close: () => ctx.close(),
  };
}
