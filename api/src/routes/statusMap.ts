import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { q } from '../db.js';

const APP = ['todo', 'in_progress', 'peer_review', 'ready_ephemeral', 'ready_acc', 'uat', 'done'] as const;

export default async function statusMapRoutes(app: FastifyInstance) {
  app.get('/api/project-mappings', async () =>
    q(`select jira_project, project_id from project_mappings order by jira_project`)
  );

  /** Reemplaza el conjunto: project_id vacío borra la equivalencia. */
  app.put('/api/project-mappings', async (req) => {
    const b = z
      .object({
        mappings: z.array(
          z.object({ jira_project: z.string().min(1), project_id: z.string() })
        ),
      })
      .parse(req.body);
    for (const m of b.mappings) {
      if (!m.project_id) {
        await q(`delete from project_mappings where jira_project = $1`, [m.jira_project]);
        continue;
      }
      await q(
        `insert into project_mappings (jira_project, project_id) values ($1,$2)
         on conflict (jira_project) do update set project_id = excluded.project_id, updated_at = now()`,
        [m.jira_project, m.project_id]
      );
    }
    return q(`select jira_project, project_id from project_mappings order by jira_project`);
  });

  app.get('/api/status-mappings', async () =>
    q(`select jira_status, app_status from status_mappings order by jira_status`)
  );

  /** Reemplaza el conjunto completo: app_status vacío borra la equivalencia. */
  app.put('/api/status-mappings', async (req) => {
    const b = z
      .object({
        mappings: z.array(
          z.object({
            jira_status: z.string().min(1),
            app_status: z.union([z.enum(APP), z.literal('')]),
          })
        ),
      })
      .parse(req.body);

    for (const m of b.mappings) {
      if (!m.app_status) {
        await q(`delete from status_mappings where jira_status = $1`, [m.jira_status]);
        continue;
      }
      await q(
        `insert into status_mappings (jira_status, app_status) values ($1,$2)
         on conflict (jira_status) do update set app_status = excluded.app_status, updated_at = now()`,
        [m.jira_status, m.app_status]
      );
    }
    return q(`select jira_status, app_status from status_mappings order by jira_status`);
  });
}
