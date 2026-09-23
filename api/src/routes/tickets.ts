import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { q } from '../db.js';

const nStr = z.union([z.string(), z.null()]).optional();
const nNum = z.union([z.number(), z.null()]).optional();

const ticket = z.object({
  key: z.string().min(1),
  summary: nStr,
  issue_type: nStr,
  jira_status: nStr,
  priority: nStr,
  component: nStr,
  epic: nStr,
  labels: z.array(z.string()).optional(),
  blocked_by: z.array(z.string()).optional(),
  sprints: z.array(z.string()).optional(),
  jira_created_at: nStr,
  jira_resolved_at: nStr,
  /** "Impediment" u otro valor en el campo Flagged de Jira. */
  flagged: nStr,
  /** Σ Time Spent: horas de TODOS (desarrollo, UAT, análisis). */
  total_time_spent: nNum,
  /** Clave del proyecto en Jira ("D8EMA"), para resolver el proyecto al crear. */
  project_key: nStr,
  /** Estimación propia de la tarea. La de la subtarea DEV no viene en este export. */
  original_estimate: nNum,
});

const body = z.object({
  dry_run: z.boolean().optional(),
  rows: z.array(ticket),
  /** Marcar como bloqueada la tarea que Jira tenga con el flag puesto. */
  apply_blocked: z.boolean().optional(),
  /** Poner el carril según las etiquetas delivery / discovery. */
  apply_track: z.boolean().optional(),
  /** Traducir el tipo de incidencia de Jira al tipo de la aplicación. */
  apply_type: z.boolean().optional(),
  /** Mover la tarea al estado equivalente, según la tabla de equivalencias. */
  apply_status: z.boolean().optional(),
  /** Crear las tareas del fichero que todavía no estén en el sprint. */
  create_missing: z.boolean().optional(),
  /** Estimación decidida a mano para las tareas que no la traen: key -> horas. */
  estimate_overrides: z.record(z.number().min(0)).optional(),
});

/** Improvement/Story -> historia, Bug -> bug, lo técnico -> técnica. */
const TYPE_MAP: Record<string, string> = {
  story: 'story',
  improvement: 'story',
  task: 'story',
  bug: 'bug',
  'technical task': 'tech',
  'technical sub-task': 'tech',
  support: 'support',
  incident: 'support',
};

export default async function ticketRoutes(app: FastifyInstance) {
  /**
   * Importa el export de incidencias de Jira (una fila por ticket) sobre las
   * tareas del sprint. Sólo rellena dimensiones de análisis; el estado propio,
   * la estimación de desarrollo y las dedicaciones no se tocan.
   */
  app.post('/api/sprints/:id/import/tickets', async (req) => {
    const { id } = req.params as { id: string };
    const b = body.parse(req.body);

    const tasks = await q<{
      uid: string; key: string; status: string; track: string; type: string; blocked: boolean;
    }>(`select uid, key, status, track, type, blocked from tasks where sprint_id = $1`, [id]);
    const byKey = new Map(tasks.map((t) => [t.key.trim().toUpperCase(), t]));

    const projMapRows = await q<{ jira_project: string; project_id: string }>(
      `select jira_project, project_id from project_mappings`
    );
    const projectMap = new Map(projMapRows.map((p) => [p.jira_project.trim().toUpperCase(), p.project_id]));
    const projects = await q<{ id: string }>(`select id from projects`);
    const projectIds = new Set(projects.map((p) => p.id));

    /**
     * Sin equivalencia guardada se intenta deducir: la clave del tablero suele ser
     * el final de la de Jira ("D8EMA" -> "EMA") o la misma ("DARWIN"). Es sólo una
     * propuesta: la interfaz la enseña para confirmarla antes de crear nada.
     */
    const guessProject = (jiraKey: string | null | undefined, issueKey: string) => {
      const jk = (jiraKey || issueKey.split('-')[0] || '').trim().toUpperCase();
      if (!jk) return null;
      const saved = projectMap.get(jk);
      if (saved) return saved;
      if (projectIds.has(jk)) return jk;
      for (const id of projectIds) {
        if (jk.endsWith(id.toUpperCase()) || jk.startsWith(id.toUpperCase())) return id;
      }
      return null;
    };

    const mapRows = await q<{ jira_status: string; app_status: string }>(
      `select jira_status, app_status from status_mappings`
    );
    const statusMap = new Map(mapRows.map((m) => [m.jira_status.trim().toLowerCase(), m.app_status]));

    const matched: any[] = [];
    const unknown: string[] = [];
    /** Tareas del fichero que no están en el sprint y podrían crearse. */
    const toCreate: any[] = [];
    // Estados de Jira que aparecen en el fichero y no tienen equivalencia puesta.
    const unmappedStatuses = new Set<string>();

    for (const r of b.rows) {
      const t = byKey.get(r.key.trim().toUpperCase());
      if (!t) {
        unknown.push(r.key);

        // La estimación de la subtarea DEV no viene en este export, así que se usa
        // la propia de la tarea; si tampoco la tiene, hay que preguntar.
        const override = b.estimate_overrides?.[r.key];
        const own = r.original_estimate ?? null;
        const estimate = override ?? own;

        toCreate.push({
          key: r.key.trim(),
          title: r.summary?.trim() || null,
          project_id: guessProject(r.project_key, r.key),
          jira_project: (r.project_key || r.key.split('-')[0] || '').trim(),
          type: r.issue_type ? TYPE_MAP[r.issue_type.trim().toLowerCase()] ?? 'story' : 'story',
          track: (r.labels ?? []).map((l) => l.toLowerCase()).includes('discovery')
            ? 'discovery'
            : 'delivery',
          status: (r.jira_status && statusMap.get(r.jira_status.trim().toLowerCase())) || 'todo',
          jira_status: r.jira_status ?? null,
          blocked: !!r.flagged?.trim(),
          estimate_hours: estimate,
          estimate_source: override != null ? 'manual' : own != null ? 'parent' : null,
          needsEstimate: estimate == null,
          priority: r.priority ?? null,
          component: r.component ?? null,
          epic: r.epic ?? null,
          labels: r.labels ?? [],
          blocked_by: r.blocked_by ?? [],
          sprints: r.sprints ?? [],
          jira_created_at: r.jira_created_at || null,
          jira_resolved_at: r.jira_resolved_at || null,
          total_time_spent: r.total_time_spent ?? null,
        });
        continue;
      }
      const labels = r.labels ?? [];
      const lower = labels.map((l) => l.toLowerCase());
      const track = lower.includes('discovery')
        ? 'discovery'
        : lower.includes('delivery')
          ? 'delivery'
          : null;
      const type = r.issue_type ? TYPE_MAP[r.issue_type.trim().toLowerCase()] ?? null : null;
      const blocked = !!r.flagged?.trim();

      const mappedStatus = r.jira_status ? statusMap.get(r.jira_status.trim().toLowerCase()) ?? null : null;
      if (r.jira_status && !mappedStatus) unmappedStatuses.add(r.jira_status.trim());

      matched.push({
        uid: t.uid,
        key: t.key,
        summary: r.summary ?? null,
        jira_status: r.jira_status ?? null,
        appStatus: t.status,
        priority: r.priority ?? null,
        component: r.component ?? null,
        epic: r.epic ?? null,
        labels,
        blocked_by: r.blocked_by ?? [],
        sprints: r.sprints ?? [],
        sprint_count: (r.sprints ?? []).length || null,
        jira_created_at: r.jira_created_at || null,
        jira_resolved_at: r.jira_resolved_at || null,
        total_time_spent: r.total_time_spent ?? null,
        blocked,
        blockedChanges: b.apply_blocked && blocked !== t.blocked,
        track,
        trackChanges: !!(b.apply_track && track && track !== t.track),
        type,
        typeChanges: !!(b.apply_type && type && type !== t.type),
        mappedStatus,
        statusChanges: !!(b.apply_status && mappedStatus && mappedStatus !== t.status),
      });
    }

    const summary = {
      received: b.rows.length,
      matched: matched.length,
      unknown,
      // lo que se crearía, con lo que falta por decidir
      toCreate,
      createCount: toCreate.length,
      needEstimate: toCreate.filter((c) => c.needsEstimate).map((c) => c.key),
      needProject: toCreate.filter((c) => !c.project_id).map((c) => ({ key: c.key, jira: c.jira_project })),
      // tareas cuyo estado en Jira no se corresponde con el que tienen aquí
      statusDivergence: matched
        .filter((m) => m.jira_status)
        .map((m) => ({ key: m.key, appStatus: m.appStatus, jiraStatus: m.jira_status })),
      blockedChanges: matched.filter((m) => m.blockedChanges).map((m) => m.key),
      trackChanges: matched.filter((m) => m.trackChanges).map((m) => `${m.key}→${m.track}`),
      typeChanges: matched.filter((m) => m.typeChanges).map((m) => `${m.key}→${m.type}`),
      statusChanges: matched
        .filter((m) => m.statusChanges)
        .map((m) => ({ key: m.key, from: m.appStatus, to: m.mappedStatus, jira: m.jira_status })),
      unmappedStatuses: [...unmappedStatuses].sort(),
      carriedOver: matched
        .filter((m) => (m.sprint_count ?? 0) > 1)
        .map((m) => ({ key: m.key, sprints: m.sprint_count, names: m.sprints })),
      blockedByLinks: matched.filter((m) => m.blocked_by.length).map((m) => ({ key: m.key, by: m.blocked_by })),
      rows: matched,
      dry_run: !!b.dry_run,
      updated: 0,
      created: 0,
    };

    if (b.dry_run) return summary;

    // Sólo se crea lo que esté completo: con proyecto resuelto y con estimación.
    // Una tarea sin estimación no entra en el burndown ni en la desviación, así
    // que meterla a medias haría más daño que dejarla fuera.
    if (b.create_missing) {
      for (const c of toCreate) {
        if (!c.project_id || c.estimate_hours == null) continue;
        await q(
          `insert into tasks (key, sprint_id, project_id, title, type, track, status, blocked,
                              estimate_hours, estimate_source, priority, component, epic, labels,
                              jira_status, jira_created_at, jira_resolved_at, sprint_count,
                              sprint_names, blocked_by, total_time_spent, jira_synced_at,
                              completed_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::text[],$15,$16::date,$17::date,
                   $18,$19::text[],$20::text[],$21, now(),
                   case when $7 = 'done' then coalesce($17::date, current_date) else null end)
           on conflict (sprint_id, key) do nothing`,
          [
            c.key, id, c.project_id, c.title, c.type, c.track, c.status, c.blocked,
            c.estimate_hours, c.estimate_source, c.priority, c.component, c.epic, c.labels,
            c.jira_status, c.jira_created_at, c.jira_resolved_at,
            c.sprints.length || null, c.sprints, c.blocked_by, c.total_time_spent,
          ]
        );
        summary.created++;
      }
    }

    for (const m of matched) {
      await q(
        `update tasks set
           priority = $2, component = $3, epic = $4, labels = $5::text[],
           jira_status = $6, jira_created_at = $7::date, jira_resolved_at = $8::date,
           sprint_count = $9, sprint_names = $10::text[], blocked_by = $11::text[],
           total_time_spent = $12,
           blocked = case when $13::boolean then $14 else blocked end,
           track   = case when $15::boolean then $16 else track   end,
           type    = case when $17::boolean then $18 else type    end,
           status  = case when $19::boolean then $20 else status  end,
           -- al pasar a DONE se fija la fecha de cierre real de Jira si la hay
           completed_at = case
             when $19::boolean and $20 = 'done' then coalesce($8::date, completed_at, current_date)
             else completed_at end,
           jira_synced_at = now(), updated_at = now()
         where uid = $1`,
        [
          m.uid, m.priority, m.component, m.epic, m.labels,
          m.jira_status, m.jira_created_at, m.jira_resolved_at,
          m.sprint_count, m.sprints, m.blocked_by, m.total_time_spent,
          !!b.apply_blocked, m.blocked,
          m.trackChanges, m.track,
          m.typeChanges, m.type,
          m.statusChanges, m.mappedStatus,
        ]
      );
      summary.updated++;
    }
    return summary;
  });
}
