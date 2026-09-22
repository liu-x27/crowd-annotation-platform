import { assignmentsSchema, createProjectSchema, updateProjectSchema } from '@crowd/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../app';
import { currentUser, requireCapability, requireUser } from '../../auth/middleware';
import { projectDto } from '../../lib/dto';
import { body } from '../../lib/validate';
import { normalized, projectFromPath } from './access';
import {
  createProject,
  deleteProject,
  getAssignments,
  listProjects,
  setAssignments,
  updateProject,
} from './service';

export function projectRoutes() {
  return new Hono<AppEnv>()
    .use(requireUser)
    .get('/', async (c) => c.json(await listProjects(c.var.deps.db, currentUser(c))))
    .post('/', requireCapability('project:manage'), async (c) => {
      const input = await body(c, createProjectSchema);
      const project = await createProject(c.var.deps.db, input, currentUser(c).id);
      return c.json(projectDto(normalized(project)), 201);
    })
    .get('/:id', async (c) => c.json(projectDto(await projectFromPath(c))))
    .patch('/:id', requireCapability('project:manage'), async (c) => {
      const project = await projectFromPath(c);
      const input = await body(c, updateProjectSchema);
      const updated = await updateProject(c.var.deps.db, project.id, input);
      c.var.deps.bus.projectChanged(project.id, 'settings');
      return c.json(projectDto(normalized(updated)));
    })
    .delete('/:id', requireCapability('project:manage'), async (c) => {
      const project = await projectFromPath(c);
      await deleteProject(c.var.deps.db, project.id);
      return c.json({ ok: true });
    })
    .get('/:id/assignments', requireCapability('project:manage'), async (c) => {
      const project = await projectFromPath(c);
      return c.json(await getAssignments(c.var.deps.db, project.id));
    })
    .put('/:id/assignments', requireCapability('project:manage'), async (c) => {
      const project = await projectFromPath(c);
      const { ranges } = await body(c, assignmentsSchema);
      return c.json(await setAssignments(c.var.deps.db, project.id, ranges));
    });
}
