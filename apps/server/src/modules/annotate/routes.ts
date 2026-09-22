import { type SubmitResult, skipSchema, submitAnnotationSchema } from '@crowd/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../app';
import { currentUser, requireCapability } from '../../auth/middleware';
import { conflict } from '../../lib/errors';
import { body, idParam } from '../../lib/validate';
import { projectFromPath } from '../projects/access';
import {
  editAnnotation,
  history,
  queueView,
  reclaimAnnotation,
  releaseAnnotation,
  skipAnnotation,
  submitAnnotation,
} from './queue';

/** Mounted at /api/projects/:id — the annotator's side of a project. */
export function annotateRoutes() {
  return (
    new Hono<AppEnv>()
      .use(requireCapability('annotate'))
      .get('/queue', async (c) => {
        const project = await projectFromPath(c);
        return c.json(await queueView(c.var.deps.db, project, currentUser(c)));
      })
      .get('/history', async (c) => {
        const project = await projectFromPath(c);
        const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 20) || 20, 1), 100);
        const before = c.req.query('before') ? Number(c.req.query('before')) : undefined;
        return c.json(await history(c.var.deps.db, project, currentUser(c), { limit, before }));
      })
      .post('/annotations/:annId/submit', async (c) => {
        const { db, bus } = c.var.deps;
        const project = await projectFromPath(c);
        if (project.archivedAt) throw conflict('archived', 'This project is archived.');
        const user = currentUser(c);
        const input = await body(c, submitAnnotationSchema);
        const { finalized } = await submitAnnotation(db, project, user, idParam(c, 'annId'), input);
        bus.projectChanged(project.id, 'annotations');
        const result: SubmitResult = {
          annotationId: idParam(c, 'annId'),
          finalized,
          next: await queueView(db, project, user),
        };
        return c.json(result);
      })
      .put('/annotations/:annId', async (c) => {
        const { db, bus } = c.var.deps;
        const project = await projectFromPath(c);
        const input = await body(c, submitAnnotationSchema);
        const result = await editAnnotation(
          db,
          project,
          currentUser(c),
          idParam(c, 'annId'),
          input,
        );
        bus.projectChanged(project.id, 'annotations');
        return c.json(result);
      })
      .post('/annotations/:annId/skip', async (c) => {
        const { db } = c.var.deps;
        const project = await projectFromPath(c);
        const user = currentUser(c);
        const { reason } = await body(c, skipSchema);
        await skipAnnotation(db, project, user, idParam(c, 'annId'), reason);
        return c.json(await queueView(db, project, user));
      })
      .post('/annotations/:annId/reclaim', async (c) => {
        const project = await projectFromPath(c);
        return c.json(
          await reclaimAnnotation(c.var.deps.db, project, currentUser(c), idParam(c, 'annId')),
        );
      })
      // Called with navigator.sendBeacon when the workspace closes, so no JSON body is expected.
      .post('/annotations/:annId/release', async (c) => {
        await projectFromPath(c);
        await releaseAnnotation(c.var.deps.db, currentUser(c), idParam(c, 'annId'));
        return c.json({ ok: true });
      })
  );
}
