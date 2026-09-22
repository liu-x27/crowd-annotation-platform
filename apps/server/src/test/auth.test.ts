import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { users } from '../db/schema';
import { type Harness, harness, PASSWORD } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await harness();
});
afterAll(async () => h.close());

describe('first run', () => {
  it('reports setup done and refuses a second admin via setup', async () => {
    const state = await h.anon().get('/api/auth/state');
    expect(state.body).toMatchObject({ needsSetup: false, user: null });
    const again = await h
      .anon()
      .post('/api/auth/setup', { username: 'intruder', password: PASSWORD });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('already_set_up');
  });
});

describe('sessions', () => {
  it('logs in, reads /me, logs out', async () => {
    const c = h.anon();
    expect((await c.get('/api/me')).status).toBe(401);
    const login = await c.post('/api/auth/login', { username: 'ADMIN', password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.capabilities).toContain('user:manage');
    expect((await c.get('/api/me')).body.username).toBe('admin');
    await c.post('/api/auth/logout');
    expect((await c.get('/api/me')).status).toBe(401);
  });

  it('rejects a wrong password with the same message as an unknown user', async () => {
    const wrong = await h
      .anon()
      .post('/api/auth/login', { username: 'admin', password: 'nope-nope' });
    const unknown = await h
      .anon()
      .post('/api/auth/login', { username: 'ghost', password: 'nope-nope' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('rate-limits repeated failures for one username', async () => {
    const c = h.anon();
    let last = 0;
    for (let i = 0; i < 12; i++)
      last = (await c.post('/api/auth/login', { username: 'limited', password: 'x' })).status;
    expect(last).toBe(429);
  });

  it('applies a role change immediately, without a new login', async () => {
    const bob = await h.user('bob');
    expect((await bob.get('/api/users')).status).toBe(403);
    await h.admin.patch(`/api/users/${bob.me.id}`, { role: 'admin' });
    expect((await bob.get('/api/users')).status).toBe(200);
  });

  it('signs a disabled user out everywhere', async () => {
    const carol = await h.user('carol');
    expect((await carol.get('/api/me')).status).toBe(200);
    await h.admin.patch(`/api/users/${carol.me.id}`, { disabled: true });
    expect((await carol.get('/api/me')).status).toBe(401);
    const relogin = await h
      .anon()
      .post('/api/auth/login', { username: 'carol', password: PASSWORD });
    expect(relogin.status).toBe(403);
  });

  it('will not demote or disable the last admin', async () => {
    const users_ = await h.admin.get('/api/users');
    const admins = users_.body.filter(
      (u: { role: string; disabled: boolean }) => u.role === 'admin' && !u.disabled,
    );
    // bob was promoted above; demote him, then try the original admin.
    for (const a of admins)
      if (a.username !== 'admin') await h.admin.patch(`/api/users/${a.id}`, { role: 'annotator' });
    const me = admins.find((a: { username: string }) => a.username === 'admin');
    const res = await h.admin.patch(`/api/users/${me.id}`, { role: 'reviewer' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('last_admin');
  });
});

describe('v1 accounts', () => {
  it('accepts a bcrypt hash from v1 and upgrades it to scrypt on login', async () => {
    const hash = await bcrypt.hash('legacy-password', 10);
    await h.deps.db
      .insert(users)
      .values({ username: 'legacy', passwordHash: hash, role: 'annotator' });
    const login = await h
      .anon()
      .post('/api/auth/login', { username: 'legacy', password: 'legacy-password' });
    expect(login.status).toBe(200);
    const [row] = await h.deps.db.select().from(users).where(eq(users.username, 'legacy'));
    expect(row!.passwordHash.startsWith('scrypt$')).toBe(true);
    const again = await h
      .anon()
      .post('/api/auth/login', { username: 'legacy', password: 'legacy-password' });
    expect(again.status).toBe(200);
  });
});

describe('request hygiene', () => {
  it('refuses state-changing requests from a foreign origin', async () => {
    const res = await h.admin.req(
      'POST',
      '/api/projects',
      { name: 'x', type: 'classification', labels: [] },
      {
        origin: 'https://evil.example',
      },
    );
    expect(res.status).toBe(403);
  });

  it('validates input and names the offending field', async () => {
    const res = await h.admin.post('/api/users', {
      username: 'x',
      password: 'short',
      role: 'annotator',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_input');
    expect(res.body.error.message).toMatch(/username|password/);
  });

  it('keeps registration closed when configured', async () => {
    const closed = await harness({ allowRegistration: false });
    try {
      const res = await closed
        .anon()
        .post('/api/auth/register', { username: 'newbie', password: PASSWORD });
      expect(res.status).toBe(403);
    } finally {
      await closed.close();
    }
  });
});
