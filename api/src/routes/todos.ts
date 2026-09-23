import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { q, one } from '../db.js';

const nStr = z.union([z.string(), z.null()]).optional();

const SELECT = `
  select t.*, s.name as sprint_name
  from sprint_todos t join sprints s on s.id = t.sprint_id`;

export default async function todoRoutes(app: FastifyInstance) {
  /**
   * Lista del sprint, más lo que quedó pendiente en otros sprints: una tarea de
   * gestión sin terminar no debe evaporarse al cerrar el sprint.
   */
  app.get('/api/sprints/:id/todos', async (req) => {
    const { id } = req.params as { id: string };
    const own = await q(
      `${SELECT} where t.sprint_id = $1 order by t.done, t.position, t.created_at`,
      [id]
    );
    const pendingElsewhere = await q(
      `${SELECT}
       where t.sprint_id <> $1 and not t.done
       order by coalesce(s.start_date, '1900-01-01') desc, t.position, t.created_at`,
      [id]
    );
    return { own, pendingElsewhere };
  });

  app.post('/api/sprints/:id/todos', async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = z
      .object({ title: z.string().min(1), notes: nStr, due_date: nStr })
      .parse(req.body);
    const pos = await one<{ next: number }>(
      `select coalesce(max(position), 0) + 1 as next from sprint_todos where sprint_id = $1`,
      [id]
    );
    const row = await one<{ id: string }>(
      `insert into sprint_todos (sprint_id, title, notes, due_date, position)
       values ($1,$2,$3,$4,$5) returning id`,
      [id, b.title.trim(), b.notes ?? null, b.due_date || null, pos?.next ?? 1]
    );
    reply.code(201);
    return one(`${SELECT} where t.id = $1`, [row!.id]);
  });

  app.put('/api/todos/:todoId', async (req) => {
    const { todoId } = req.params as { todoId: string };
    const b = z
      .object({
        title: z.string().min(1).optional(),
        notes: nStr,
        due_date: nStr,
        done: z.boolean().optional(),
        position: z.number().int().optional(),
        /** Mover la tarea a otro sprint sin perder su histórico. */
        sprint_id: z.string().min(1).optional(),
      })
      .parse(req.body);

    await q(
      `update sprint_todos set
         title    = coalesce($2, title),
         notes    = case when $3::boolean then $4 else notes end,
         due_date = case when $5::boolean then $6::date else due_date end,
         done     = coalesce($7, done),
         -- la fecha de hecho se pone y se quita sola al marcar y desmarcar
         done_at  = case
                      when $7 is null then done_at
                      when $7 and done_at is null then now()
                      when not $7 then null
                      else done_at end,
         position  = coalesce($8, position),
         sprint_id = coalesce($9, sprint_id),
         updated_at = now()
       where id = $1`,
      [
        todoId, b.title ?? null,
        'notes' in b, b.notes ?? null,
        'due_date' in b, b.due_date || null,
        b.done ?? null, b.position ?? null, b.sprint_id ?? null,
      ]
    );
    return one(`${SELECT} where t.id = $1`, [todoId]);
  });

  app.delete('/api/todos/:todoId', async (req, reply) => {
    const { todoId } = req.params as { todoId: string };
    await q(`delete from sprint_todos where id = $1`, [todoId]);
    reply.code(204);
  });
}
