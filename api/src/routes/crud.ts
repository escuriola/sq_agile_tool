import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { q, one } from '../db.js';

const nullableNum = z.union([z.number(), z.null()]).optional();
const nullableStr = z.union([z.string(), z.null()]).optional();

const TASK_STATUS = ['todo', 'in_progress', 'peer_review', 'ready_ephemeral',
                     'ready_acc', 'uat', 'done'] as const;
const TASK_TYPE = ['story', 'bug', 'tech', 'support'] as const;
const TASK_TRACK = ['delivery', 'discovery'] as const;

const dedicationInput = z.object({
  /** Id de una dedicación ya existente: permite editarla sin perder su origen. */
  id: z.string().uuid().optional(),
  user_id: z.string().min(1),
  hours: z.number().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: nullableStr,
});

export default async function crudRoutes(app: FastifyInstance) {
  /* ------------------------------------------------------------------ users */

  app.get('/api/users', async () =>
    q(`select * from users order by active desc, name`)
  );

  app.post('/api/users', async (req, reply) => {
    const b = z
      .object({
        id: z.string().min(1),
        name: z.string().min(1),
        capacity_hours: nullableNum,
        active: z.boolean().optional(),
      })
      .parse(req.body);
    const row = await one(
      `insert into users (id, name, capacity_hours, active)
       values ($1,$2,$3,coalesce($4,true)) returning *`,
      [b.id, b.name, b.capacity_hours ?? null, b.active ?? null]
    );
    reply.code(201);
    return row;
  });

  app.put('/api/users/:id', async (req) => {
    const { id } = req.params as { id: string };
    const b = z
      .object({
        name: z.string().min(1).optional(),
        capacity_hours: nullableNum,
        active: z.boolean().optional(),
      })
      .parse(req.body);
    return one(
      `update users set
         name = coalesce($2, name),
         capacity_hours = case when $3::boolean then $4::numeric else capacity_hours end,
         active = coalesce($5, active)
       where id = $1 returning *`,
      [id, b.name ?? null, 'capacity_hours' in b, b.capacity_hours ?? null, b.active ?? null]
    );
  });

  app.delete('/api/users/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    await q(`delete from users where id = $1`, [id]);
    reply.code(204);
  });

  /* --------------------------------------------------------------- projects */

  app.get('/api/projects', async () => q(`select * from projects order by id`));

  app.post('/api/projects', async (req, reply) => {
    const b = z
      .object({ id: z.string().min(1), name: z.string().min(1), color: nullableStr })
      .parse(req.body);
    const row = await one(
      `insert into projects (id, name, color) values ($1,$2,$3) returning *`,
      [b.id, b.name, b.color ?? null]
    );
    reply.code(201);
    return row;
  });

  app.put('/api/projects/:id', async (req) => {
    const { id } = req.params as { id: string };
    const b = z.object({ name: z.string().min(1).optional(), color: nullableStr }).parse(req.body);
    return one(
      `update projects set name = coalesce($2, name), color = coalesce($3, color)
       where id = $1 returning *`,
      [id, b.name ?? null, b.color ?? null]
    );
  });

  app.delete('/api/projects/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    await q(`delete from projects where id = $1`, [id]);
    reply.code(204);
  });

  /* ---------------------------------------------------------------- sprints */

  app.get('/api/sprints', async () =>
    q(`select s.*,
              (select count(*) from tasks t where t.sprint_id = s.id)::int as task_count
       from sprints s
       order by coalesce(s.start_date, '1900-01-01') desc, s.id desc`)
  );

  app.get('/api/sprints/:id', async (req) => {
    const { id } = req.params as { id: string };
    return one(`select * from sprints where id = $1`, [id]);
  });

  app.post('/api/sprints', async (req, reply) => {
    const b = z
      .object({
        id: z.string().min(1),
        name: z.string().min(1),
        start_date: nullableStr,
        end_date: nullableStr,
        goal: nullableStr,
        status: z.enum(['planned', 'active', 'closed']).optional(),
        discovery_ratio: z.number().min(0).max(1).optional(),
        commit_factor: z.number().gt(0).max(3).optional(),
      })
      .parse(req.body);
    const row = await one(
      `insert into sprints (id, name, start_date, end_date, goal, status, discovery_ratio)
       values ($1,$2,$3,$4,$5,coalesce($6,'planned'),coalesce($7,0.20)) returning *`,
      [
        b.id, b.name, b.start_date ?? null, b.end_date ?? null, b.goal ?? null,
        b.status ?? null, b.discovery_ratio ?? null,
      ]
    );
    reply.code(201);
    return row;
  });

  app.put('/api/sprints/:id', async (req) => {
    const { id } = req.params as { id: string };
    const b = z
      .object({
        name: z.string().min(1).optional(),
        start_date: nullableStr,
        end_date: nullableStr,
        goal: nullableStr,
        status: z.enum(['planned', 'active', 'closed']).optional(),
        discovery_ratio: z.number().min(0).max(1).optional(),
        commit_factor: z.number().gt(0).max(3).optional(),
      })
      .parse(req.body);
    return one(
      `update sprints set
         name = coalesce($2, name),
         start_date = coalesce($3, start_date),
         end_date = coalesce($4, end_date),
         goal = coalesce($5, goal),
         status = coalesce($6, status),
         discovery_ratio = coalesce($7, discovery_ratio),
         commit_factor = coalesce($8, commit_factor)
       where id = $1 returning *`,
      [
        id, b.name ?? null, b.start_date ?? null, b.end_date ?? null, b.goal ?? null,
        b.status ?? null, b.discovery_ratio ?? null, b.commit_factor ?? null,
      ]
    );
  });

  app.delete('/api/sprints/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    await q(`delete from sprints where id = $1`, [id]);
    reply.code(204);
  });

  /* ------------------------------------------------- capacidad por sprint */

  // Devuelve a todo el equipo activo con su capacidad para ESTE sprint.
  // Si no hay fila propia del sprint todavía, se propone la capacidad por
  // defecto del usuario, marcándolo con is_override = false.
  app.get('/api/sprints/:id/capacities', async (req) => {
    const { id } = req.params as { id: string };
    return q(
      `select u.id                                        as user_id,
              u.name,
              u.active,
              u.capacity_hours                            as default_hours,
              sc.capacity_hours                           as sprint_hours,
              coalesce(sc.capacity_hours, u.capacity_hours, 0) as effective_hours,
              (sc.user_id is not null)                    as is_override,
              sc.note
       from users u
       left join sprint_capacities sc on sc.user_id = u.id and sc.sprint_id = $1
       where u.active or sc.user_id is not null
       order by u.active desc, u.name`,
      [id]
    );
  });

  // Reemplaza el conjunto de capacidades del sprint. capacity_hours = null quita
  // la fila y devuelve a la persona a su valor por defecto.
  app.put('/api/sprints/:id/capacities', async (req) => {
    const { id } = req.params as { id: string };
    const b = z
      .object({
        capacities: z.array(
          z.object({
            user_id: z.string().min(1),
            capacity_hours: z.union([z.number().min(0), z.null()]),
            note: nullableStr,
          })
        ),
      })
      .parse(req.body);

    for (const c of b.capacities) {
      if (c.capacity_hours === null) {
        await q(`delete from sprint_capacities where sprint_id = $1 and user_id = $2`, [id, c.user_id]);
        continue;
      }
      await q(
        `insert into sprint_capacities (sprint_id, user_id, capacity_hours, note)
         values ($1,$2,$3,$4)
         on conflict (sprint_id, user_id)
         do update set capacity_hours = excluded.capacity_hours,
                       note = excluded.note,
                       updated_at = now()`,
        [id, c.user_id, c.capacity_hours, c.note ?? null]
      );
    }

    return q(
      `select u.id as user_id, u.name, u.active, u.capacity_hours as default_hours,
              sc.capacity_hours as sprint_hours,
              coalesce(sc.capacity_hours, u.capacity_hours, 0) as effective_hours,
              (sc.user_id is not null) as is_override, sc.note
       from users u
       left join sprint_capacities sc on sc.user_id = u.id and sc.sprint_id = $1
       where u.active or sc.user_id is not null
       order by u.active desc, u.name`,
      [id]
    );
  });

  // Copia las capacidades de otro sprint (lo habitual: el anterior).
  app.post('/api/sprints/:id/capacities/copy', async (req) => {
    const { id } = req.params as { id: string };
    const b = z.object({ from_sprint_id: z.string().min(1) }).parse(req.body);
    await q(
      `insert into sprint_capacities (sprint_id, user_id, capacity_hours, note)
       select $1, sc.user_id, sc.capacity_hours, sc.note
       from sprint_capacities sc where sc.sprint_id = $2
       on conflict (sprint_id, user_id)
       do update set capacity_hours = excluded.capacity_hours, updated_at = now()`,
      [id, b.from_sprint_id]
    );
    return q(
      `select u.id as user_id, u.name, u.active, u.capacity_hours as default_hours,
              sc.capacity_hours as sprint_hours,
              coalesce(sc.capacity_hours, u.capacity_hours, 0) as effective_hours,
              (sc.user_id is not null) as is_override, sc.note
       from users u
       left join sprint_capacities sc on sc.user_id = u.id and sc.sprint_id = $1
       where u.active or sc.user_id is not null
       order by u.active desc, u.name`,
      [id]
    );
  });

  /* ------------------------------------------------------------------ tasks */

  const tasksWithDedications = (where: string, params: any[]) =>
    q(
      `select t.*,
              coalesce(d.total, 0) as logged_hours,
              coalesce(d.items, '[]'::json) as dedications
       from tasks t
       left join lateral (
         select sum(dd.hours) as total,
                json_agg(json_build_object(
                  'id', dd.id, 'task_uid', dd.task_uid, 'user_id', dd.user_id,
                  'hours', dd.hours, 'date', dd.date, 'note', dd.note
                ) order by dd.date, dd.created_at) as items
         from dedications dd where dd.task_uid = t.uid
       ) d on true
       ${where}
       order by t.project_id, t.key`,
      params
    );

  app.get('/api/sprints/:id/tasks', async (req) => {
    const { id } = req.params as { id: string };
    return tasksWithDedications('where t.sprint_id = $1', [id]);
  });

  app.get('/api/tasks/:uid', async (req) => {
    const { uid } = req.params as { uid: string };
    const rows = await tasksWithDedications('where t.uid = $1', [uid]);
    return rows[0] ?? null;
  });

  app.post('/api/tasks', async (req, reply) => {
    const b = z
      .object({
        key: z.string().min(1),
        sprint_id: z.string().min(1),
        project_id: z.string().min(1),
        title: nullableStr,
        type: z.enum(TASK_TYPE).optional(),
        track: z.enum(TASK_TRACK).optional(),
        status: z.enum(TASK_STATUS).optional(),
        estimate_points: nullableNum,
        estimate_hours: nullableNum,
        assignee_id: nullableStr,
        comment: nullableStr,
        added_after_start: z.boolean().optional(),
        blocked: z.boolean().optional(),
        completed_at: nullableStr,
        dedications: z.array(dedicationInput).optional(),
      })
      .parse(req.body);

    const task = await one<{ uid: string }>(
      `insert into tasks (key, sprint_id, project_id, title, type, track, status,
                          estimate_points, estimate_hours, assignee_id, comment,
                          added_after_start, blocked, completed_at)
       values ($1,$2,$3,$4,coalesce($5,'story'),coalesce($6,'delivery'),coalesce($7,'todo'),
               $8,$9,$10,$11,coalesce($12,false),coalesce($13,false),$14)
       returning uid`,
      [
        b.key, b.sprint_id, b.project_id, b.title ?? null, b.type ?? null, b.track ?? null,
        b.status ?? null,
        b.estimate_points ?? null, b.estimate_hours ?? null, b.assignee_id || null,
        b.comment ?? null, b.added_after_start ?? null, b.blocked ?? null,
        b.completed_at ?? (b.status === 'done' ? new Date().toISOString().slice(0, 10) : null),
      ]
    );

    for (const d of b.dedications ?? []) {
      await q(
        `insert into dedications (task_uid, user_id, hours, date, note) values ($1,$2,$3,$4,$5)`,
        [task!.uid, d.user_id, d.hours, d.date, d.note ?? null]
      );
    }

    reply.code(201);
    const rows = await tasksWithDedications('where t.uid = $1', [task!.uid]);
    return rows[0];
  });

  app.put('/api/tasks/:uid', async (req) => {
    const { uid } = req.params as { uid: string };
    const b = z
      .object({
        key: z.string().min(1).optional(),
        project_id: z.string().min(1).optional(),
        title: nullableStr,
        type: z.enum(TASK_TYPE).optional(),
        track: z.enum(TASK_TRACK).optional(),
        status: z.enum(TASK_STATUS).optional(),
        estimate_points: nullableNum,
        estimate_hours: nullableNum,
        assignee_id: nullableStr,
        comment: nullableStr,
        added_after_start: z.boolean().optional(),
        blocked: z.boolean().optional(),
        completed_at: nullableStr,
        dedications: z.array(dedicationInput).optional(),
      })
      .parse(req.body);

    // completed_at se rellena solo al pasar a 'done' y se limpia al salir de 'done',
    // salvo que venga explícito en el cuerpo.
    const explicitCompleted = 'completed_at' in b;

    await q(
      `update tasks set
         key = coalesce($2, key),
         project_id = coalesce($3, project_id),
         title = case when $4::boolean then $5 else title end,
         type = coalesce($6, type),
         status = coalesce($7, status),
         estimate_points = case when $8::boolean then $9::numeric else estimate_points end,
         estimate_hours  = case when $10::boolean then $11::numeric else estimate_hours end,
         -- escribir la estimación a mano la blinda frente a futuras importaciones
         estimate_source = case when $10::boolean then 'manual' else estimate_source end,
         assignee_id = case when $12::boolean then $13 else assignee_id end,
         comment = case when $14::boolean then $15 else comment end,
         added_after_start = coalesce($16, added_after_start),
         track = coalesce($19, track),
         blocked = coalesce($20, blocked),
         completed_at = case
           when $17::boolean then $18::date
           when $7 = 'done' and completed_at is null then current_date
           when $7 is not null and $7 <> 'done' then null
           else completed_at end,
         updated_at = now()
       where uid = $1`,
      [
        uid, b.key ?? null, b.project_id ?? null,
        'title' in b, b.title ?? null,
        b.type ?? null, b.status ?? null,
        'estimate_points' in b, b.estimate_points ?? null,
        'estimate_hours' in b, b.estimate_hours ?? null,
        'assignee_id' in b, b.assignee_id || null,
        'comment' in b, b.comment ?? null,
        b.added_after_start ?? null,
        explicitCompleted, b.completed_at ?? null,
        b.track ?? null,
        b.blocked ?? null,
      ]
    );

    // Las dedicaciones se reconcilian por id, no se borran y recrean: si no,
    // editar una tarea perdía el id de worklog y la marca de tiempo de las
    // importadas, y la siguiente importación las habría duplicado.
    if (b.dedications) {
      const keep = b.dedications.map((d) => d.id).filter(Boolean) as string[];
      await q(
        `delete from dedications where task_uid = $1 and not (id = any($2::uuid[]))`,
        [uid, keep]
      );
      for (const d of b.dedications) {
        if (d.id) {
          await q(
            `update dedications set user_id = $2, hours = $3, date = $4, note = $5
             where id = $1`,
            [d.id, d.user_id, d.hours, d.date, d.note ?? null]
          );
        } else {
          await q(
            `insert into dedications (task_uid, user_id, hours, date, note) values ($1,$2,$3,$4,$5)`,
            [uid, d.user_id, d.hours, d.date, d.note ?? null]
          );
        }
      }
    }

    const rows = await tasksWithDedications('where t.uid = $1', [uid]);
    return rows[0] ?? null;
  });

  app.delete('/api/tasks/:uid', async (req, reply) => {
    const { uid } = req.params as { uid: string };
    await q(`delete from tasks where uid = $1`, [uid]);
    reply.code(204);
  });

  /* ------------------------------------------------------------ dedications */

  app.post('/api/tasks/:uid/dedications', async (req, reply) => {
    const { uid } = req.params as { uid: string };
    const b = dedicationInput.parse(req.body);
    const row = await one(
      `insert into dedications (task_uid, user_id, hours, date, note)
       values ($1,$2,$3,$4,$5) returning *`,
      [uid, b.user_id, b.hours, b.date, b.note ?? null]
    );
    reply.code(201);
    return row;
  });

  app.delete('/api/dedications/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    await q(`delete from dedications where id = $1`, [id]);
    reply.code(204);
  });

  /* ------------------------------------------- arrastrar tareas a otro sprint */

  app.post('/api/sprints/:id/carry-over', async (req) => {
    const { id } = req.params as { id: string };
    const b = z.object({ from_sprint_id: z.string().min(1) }).parse(req.body);
    return q(
      `insert into tasks (key, sprint_id, project_id, title, type, status,
                          estimate_points, estimate_hours, assignee_id, comment, added_after_start)
       select t.key, $1, t.project_id, t.title, t.type, t.status,
              t.estimate_points, t.estimate_hours, t.assignee_id, t.comment, false
       from tasks t
       where t.sprint_id = $2 and t.status <> 'done'
         and not exists (select 1 from tasks x where x.sprint_id = $1 and x.key = t.key)
       returning *`,
      [id, b.from_sprint_id]
    );
  });
}
