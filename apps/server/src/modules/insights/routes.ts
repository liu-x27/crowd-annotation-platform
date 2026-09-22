import { llmPreviewSchema, predictSchema, prelabelJobSchema, trainJobSchema } from '@crowd/shared';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppEnv } from '../../app';
import { currentUser, requireCapability } from '../../auth/middleware';
import { jobs } from '../../db/schema';
import { notFound } from '../../lib/errors';
import { body, idParam } from '../../lib/validate';
import { validTimeZone } from '../accounts/routes';
import { previewDrafts } from '../llm/prelabel';
import { agreement, draftQuality, overview } from '../metrics/reports';
import { projectFromPath } from '../projects/access';
import { listModels } from '../training/job';

/** Mounted at /api/projects/:id — statistics, LLM drafting and student models. */
export function insightRoutes() {
  return new Hono<AppEnv>()
    .get('/stats/overview', requireCapability('project:read_all'), async (c) => {
      const project = await projectFromPath(c);
      return c.json(await overview(c.var.deps.db, project, validTimeZone(c.req.query('tz'))));
    })
    .get('/stats/agreement', requireCapability('project:read_all'), async (c) => {
      const project = await projectFromPath(c);
      return c.json(await agreement(c.var.deps.db, project));
    })
    .get('/stats/drafts', requireCapability('project:read_all'), async (c) => {
      const project = await projectFromPath(c);
      const ref = c.req.query('reference');
      const reference = ref === 'human' || ref === 'import' ? ref : 'final';
      return c.json(await draftQuality(c.var.deps.db, project, reference));
    })
    .post('/llm/preview', requireCapability('llm:run'), async (c) => {
      const project = await projectFromPath(c);
      const input = await body(c, llmPreviewSchema);
      return c.json(await previewDrafts(c.var.deps.db, c.var.deps.llm, project.id, input));
    })
    .post('/llm/jobs', requireCapability('llm:run'), async (c) => {
      const project = await projectFromPath(c);
      const params = await body(c, prelabelJobSchema);
      const job = await c.var.deps.jobs.enqueue({
        kind: 'prelabel',
        projectId: project.id,
        params,
        createdBy: currentUser(c).id,
      });
      return c.json(job, 202);
    })
    .get('/models', requireCapability('project:read_all'), async (c) => {
      const project = await projectFromPath(c);
      return c.json(await listModels(c.var.deps.db, project.id));
    })
    .post('/models', requireCapability('model:train'), async (c) => {
      const project = await projectFromPath(c);
      const params = await body(c, trainJobSchema);
      const job = await c.var.deps.jobs.enqueue({
        kind: 'train',
        projectId: project.id,
        params,
        createdBy: currentUser(c).id,
      });
      return c.json(job, 202);
    })
    .post('/models/:jobId/predict', requireCapability('project:read_all'), async (c) => {
      const project = await projectFromPath(c);
      const jobId = idParam(c, 'jobId');
      const [job] = await c.var.deps.db
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(
            eq(jobs.id, jobId),
            eq(jobs.projectId, project.id),
            eq(jobs.kind, 'train'),
            eq(jobs.status, 'succeeded'),
          ),
        );
      if (!job) throw notFound('Model');
      const { text } = await body(c, predictSchema);
      return c.json(await c.var.deps.models.predict(jobId, text));
    })
    .delete('/models/:jobId', requireCapability('model:train'), async (c) => {
      const project = await projectFromPath(c);
      const jobId = idParam(c, 'jobId');
      const deleted = await c.var.deps.db
        .delete(jobs)
        .where(and(eq(jobs.id, jobId), eq(jobs.projectId, project.id), eq(jobs.kind, 'train')))
        .returning({ id: jobs.id });
      if (!deleted.length) throw notFound('Model');
      await c.var.deps.models.remove(jobId);
      return c.json({ ok: true });
    });
}
