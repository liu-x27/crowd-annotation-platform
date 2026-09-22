import { can, type ServerEvent } from '@crowd/shared';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AppEnv } from '../../app';
import { currentUser, requireCapability, requireUser } from '../../auth/middleware';
import { idParam } from '../../lib/validate';

export function systemRoutes() {
  return (
    new Hono<AppEnv>()
      .get('/llm/providers', requireCapability('llm:run'), async (c) =>
        c.json(await c.var.deps.llm.describeAll()),
      )
      .get('/jobs', requireCapability('project:read_all'), async (c) => {
        const projectId = c.req.query('projectId') ? Number(c.req.query('projectId')) : undefined;
        return c.json(await c.var.deps.jobs.list({ projectId, limit: 50 }));
      })
      .get('/jobs/:id', requireCapability('project:read_all'), async (c) =>
        c.json(await c.var.deps.jobs.get(idParam(c))),
      )
      .post('/jobs/:id/cancel', requireCapability('project:manage'), async (c) =>
        c.json(await c.var.deps.jobs.cancel(idParam(c))),
      )

      /**
       * Server-sent events: job progress, training epochs, and "this project changed" notices
       * the client turns into cache invalidations. Filtered to one project if asked; job and
       * epoch events only go to users who can see every project.
       */
      .get('/events', requireUser, (c) => {
        const user = currentUser(c);
        const projectFilter = c.req.query('projectId') ? Number(c.req.query('projectId')) : null;
        const seesJobs = can(user.role, 'project:read_all');
        const wanted = (e: ServerEvent): boolean => {
          const pid = e.type === 'job' ? e.job.projectId : e.projectId;
          if (projectFilter != null && pid !== projectFilter) return false;
          return e.type === 'project' || seesJobs;
        };
        return streamSSE(c, async (stream) => {
          const pending: ServerEvent[] = [];
          let wake: (() => void) | null = null;
          let closed = false;
          const unsubscribe = c.var.deps.bus.subscribe((e) => {
            if (!wanted(e)) return;
            pending.push(e);
            wake?.();
          });
          stream.onAbort(() => {
            closed = true;
            wake?.();
          });
          const heartbeat = setInterval(() => {
            void stream.writeSSE({ event: 'ping', data: '' }).catch(() => undefined);
          }, 25_000);
          try {
            await stream.writeSSE({ event: 'ready', data: '{}' });
            while (!closed) {
              if (pending.length === 0) {
                await new Promise<void>((resolve) => {
                  wake = resolve;
                });
                wake = null;
              }
              while (pending.length && !closed) {
                const e = pending.shift()!;
                await stream.writeSSE({ event: e.type, data: JSON.stringify(e) });
              }
            }
          } finally {
            clearInterval(heartbeat);
            unsubscribe();
          }
        });
      })
  );
}
