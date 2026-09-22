import {
  bulkFinalizeSchema,
  exportQuerySchema,
  finalizeSchema,
  importBatchSchema,
  rejectSchema,
  reviewQueueQuerySchema,
} from '@crowd/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../app';
import { currentUser, requireCapability } from '../../auth/middleware';
import { body, idParam, query } from '../../lib/validate';
import { projectFromPath } from '../projects/access';
import {
  bulkFinalize,
  finalizeItem,
  rejectAnnotation,
  reopenItem,
  reviewEntries,
  reviewQueue,
} from '../review/service';
import { exportFilename, exportStream } from './export';
import { deleteItems, importBatch, itemDetail, listItems } from './service';

/** Mounted at /api/projects/:id — data management, review and export. */
export function itemRoutes() {
  return new Hono<AppEnv>()
    .get('/items', requireCapability('project:read_all'), async (c) => {
      const project = await projectFromPath(c);
      return c.json(await listItems(c.var.deps.db, project, c.req.query()));
    })
    .post('/items/batch', requireCapability('project:manage'), async (c) => {
      const project = await projectFromPath(c);
      const input = await body(c, importBatchSchema);
      const result = await importBatch(c.var.deps.db, project, input);
      c.var.deps.bus.projectChanged(project.id, 'items');
      return c.json(result);
    })
    .post('/items/delete', requireCapability('project:manage'), async (c) => {
      const project = await projectFromPath(c);
      const { ids } = await body(
        c,
        z.object({ ids: z.array(z.number().int().positive()).min(1).max(10_000) }),
      );
      const deleted = await deleteItems(c.var.deps.db, project, ids);
      c.var.deps.bus.projectChanged(project.id, 'items');
      return c.json({ deleted });
    })
    .get('/items/:itemId', requireCapability('project:read_all'), async (c) => {
      const project = await projectFromPath(c);
      return c.json(await itemDetail(c.var.deps.db, project, idParam(c, 'itemId')));
    })
    .post('/items/:itemId/finalize', requireCapability('review'), async (c) => {
      const { db, bus } = c.var.deps;
      const project = await projectFromPath(c);
      const input = await body(c, finalizeSchema);
      await finalizeItem(db, project, currentUser(c), idParam(c, 'itemId'), input);
      bus.projectChanged(project.id, 'review');
      const [entry] = await reviewEntries(db, project, [idParam(c, 'itemId')]);
      return c.json(entry);
    })
    .post('/items/:itemId/reopen', requireCapability('review'), async (c) => {
      const { db, bus } = c.var.deps;
      const project = await projectFromPath(c);
      await reopenItem(db, project, idParam(c, 'itemId'));
      bus.projectChanged(project.id, 'review');
      const [entry] = await reviewEntries(db, project, [idParam(c, 'itemId')]);
      return c.json(entry);
    })
    .get('/review', requireCapability('review'), async (c) => {
      const project = await projectFromPath(c);
      return c.json(await reviewQueue(c.var.deps.db, project, query(c, reviewQueueQuerySchema)));
    })
    .post('/review/bulk-finalize', requireCapability('review'), async (c) => {
      const { db, bus } = c.var.deps;
      const project = await projectFromPath(c);
      const input = await body(c, bulkFinalizeSchema);
      const result = await bulkFinalize(db, project, currentUser(c), input.strategy, input.itemIds);
      bus.projectChanged(project.id, 'review');
      return c.json(result);
    })
    .post('/annotations/:annId/reject', requireCapability('review'), async (c) => {
      const { db, bus } = c.var.deps;
      const project = await projectFromPath(c);
      const { note } = await body(c, rejectSchema);
      await rejectAnnotation(db, project, currentUser(c), idParam(c, 'annId'), note);
      bus.projectChanged(project.id, 'review');
      return c.json({ ok: true });
    })
    .get('/export', requireCapability('data:export'), async (c) => {
      const project = await projectFromPath(c);
      const opts = query(c, exportQuerySchema);
      const stream = exportStream(c.var.deps.db, project, opts);
      const name = exportFilename(project, opts);
      const type =
        opts.format === 'csv'
          ? 'text/csv'
          : opts.format === 'jsonl'
            ? 'application/x-ndjson'
            : 'text/plain';
      return new Response(stream, {
        headers: {
          'content-type': `${type}; charset=utf-8`,
          'content-disposition': `attachment; filename="${name.ascii}"; filename*=UTF-8''${encodeURIComponent(name.utf8)}`,
          'cache-control': 'no-store',
        },
      });
    });
}
