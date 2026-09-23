import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { q, one } from '../db.js';

const nullableStr = z.union([z.string(), z.null()]).optional();
const STATUS = ['pending', 'in_progress', 'done', 'dropped'] as const;

const SELECT = `
  select ra.*, u.name as owner_name, s.name as sprint_name, s.start_date as sprint_start
  from retro_actions ra
  left join users u on u.id = ra.owner_id
  join sprints s on s.id = ra.sprint_id`;

export default async function retroRoutes(app: FastifyInstance) {
  /**
   * Acciones de la retro de este sprint más las que siguen abiertas de sprints
   * anteriores: una acción SMART no sirve de nada si nadie la revisa después.
   */
  app.get('/api/sprints/:id/retro', async (req) => {
    const { id } = req.params as { id: string };
    const own = await q(`${SELECT} where ra.sprint_id = $1 order by ra.created_at`, [id]);
    const pending = await q(
      `${SELECT}
       where ra.sprint_id <> $1
         and ra.status in ('pending', 'in_progress')
       order by ra.due_date nulls last, ra.created_at`,
      [id]
    );
    return { own, carriedOver: pending };
  });

  /** Todas, para una vista global del histórico de acciones. */
  app.get('/api/retro', async () =>
    q(`${SELECT} order by coalesce(s.start_date, '1900-01-01') desc, ra.created_at`)
  );

  app.post('/api/sprints/:id/retro', async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = z
      .object({
        title: z.string().min(1),
        measurable: nullableStr,
        achievable: nullableStr,
        relevant: nullableStr,
        due_date: nullableStr,
        owner_id: nullableStr,
        status: z.enum(STATUS).optional(),
      })
      .parse(req.body);

    const row = await one<{ id: string }>(
      `insert into retro_actions
         (sprint_id, title, measurable, achievable, relevant, due_date, owner_id, status)
       values ($1,$2,$3,$4,$5,$6,$7,coalesce($8,'pending'))
       returning id`,
      [
        id, b.title.trim(), b.measurable ?? null, b.achievable ?? null, b.relevant ?? null,
        b.due_date || null, b.owner_id || null, b.status ?? null,
      ]
    );
    reply.code(201);
    return one(`${SELECT} where ra.id = $1`, [row!.id]);
  });

  app.put('/api/retro/:actionId', async (req) => {
    const { actionId } = req.params as { actionId: string };
    const b = z
      .object({
        title: z.string().min(1).optional(),
        measurable: nullableStr,
        achievable: nullableStr,
        relevant: nullableStr,
        due_date: nullableStr,
        owner_id: nullableStr,
        status: z.enum(STATUS).optional(),
        outcome: nullableStr,
      })
      .parse(req.body);

    await q(
      `update retro_actions set
         title      = coalesce($2, title),
         measurable = case when $3::boolean then $4  else measurable end,
         achievable = case when $5::boolean then $6  else achievable end,
         relevant   = case when $7::boolean then $8  else relevant   end,
         due_date   = case when $9::boolean then $10::date else due_date end,
         owner_id   = case when $11::boolean then $12 else owner_id end,
         outcome    = case when $13::boolean then $14 else outcome  end,
         status     = coalesce($15, status),
         updated_at = now()
       where id = $1`,
      [
        actionId, b.title ?? null,
        'measurable' in b, b.measurable ?? null,
        'achievable' in b, b.achievable ?? null,
        'relevant' in b, b.relevant ?? null,
        'due_date' in b, b.due_date || null,
        'owner_id' in b, b.owner_id || null,
        'outcome' in b, b.outcome ?? null,
        b.status ?? null,
      ]
    );
    return one(`${SELECT} where ra.id = $1`, [actionId]);
  });

  app.delete('/api/retro/:actionId', async (req, reply) => {
    const { actionId } = req.params as { actionId: string };
    await q(`delete from retro_actions where id = $1`, [actionId]);
    reply.code(204);
  });
}
