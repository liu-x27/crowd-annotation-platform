import { can, projectSettingsSchema } from '@crowd/shared';
import type { Context } from 'hono';
import type { AppEnv } from '../../app';
import { currentUser } from '../../auth/middleware';
import type { ProjectRow } from '../../db/schema';
import { notFound } from '../../lib/errors';
import { idParam } from '../../lib/validate';
import { getProject } from './service';

/** Settings are validated on the way in; parsing again on the way out fills keys added since. */
export function normalized(project: ProjectRow): ProjectRow {
  return { ...project, settings: projectSettingsSchema.parse(project.settings) };
}

/**
 * The project named in the path, if the current user may see it. Archived projects are
 * hidden from anyone who cannot read all projects (404, not 403: no existence leak).
 */
export async function projectFromPath(c: Context<AppEnv>): Promise<ProjectRow> {
  const user = currentUser(c);
  const project = normalized(await getProject(c.var.deps.db, idParam(c, 'id')));
  if (project.archivedAt && !can(user.role, 'project:read_all')) throw notFound('Project');
  return project;
}
