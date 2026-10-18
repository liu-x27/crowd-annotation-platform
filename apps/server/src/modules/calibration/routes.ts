import { calibrationDrawSchema, calibrationReportQuerySchema } from '@crowd/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../app';
import { requireCapability } from '../../auth/middleware';
import { body, query } from '../../lib/validate';
import { projectFromPath } from '../projects/access';
import { calibrationReport, clearCalibration, drawCalibration } from './service';

/** Mounted at /api/projects/:id — the calibration set and what it says about the drafts. */
export function calibrationRoutes() {
  return new Hono<AppEnv>()
    .get('/calibration', requireCapability('project:read_all'), async (c) => {
      const project = await projectFromPath(c);
      const { epsilon } = query(c, calibrationReportQuerySchema);
      return c.json(await calibrationReport(c.var.deps.db, project, epsilon));
    })
    .post('/calibration', requireCapability('project:manage'), async (c) => {
      const project = await projectFromPath(c);
      const { size } = await body(c, calibrationDrawSchema);
      const result = await drawCalibration(c.var.deps.db, project, size);
      c.var.deps.bus.projectChanged(project.id, 'items');
      return c.json(result, 201);
    })
    .delete('/calibration', requireCapability('project:manage'), async (c) => {
      const project = await projectFromPath(c);
      const result = await clearCalibration(c.var.deps.db, project);
      c.var.deps.bus.projectChanged(project.id, 'items');
      return c.json(result);
    });
}
