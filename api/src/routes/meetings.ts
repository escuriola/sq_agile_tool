import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { q, one } from '../db.js';

const nStr = z.union([z.string(), z.null()]).optional();

/** Preguntas de una reunión, en el orden en que se hacen. */
const answersOf = (meetingId: string) =>
  q(
    `select id, section, section_hint, question, is_core, answer, position
       from meeting_answers where meeting_id = $1 order by position, id`,
    [meetingId]
  );

export default async function meetingRoutes(app: FastifyInstance) {
  /* ------------------------------------------------------------ plantillas */

  app.get('/api/meeting-templates', async () => {
    const templates = await q(
      `select * from meeting_templates order by is_default desc, name`
    );
    for (const t of templates as any[]) {
      t.questions = await q(
        `select id, section, section_hint, question, is_core, position
           from meeting_template_questions where template_id = $1 order by position, id`,
        [t.id]
      );
    }
    return templates;
  });

  /**
   * Guarda el guion entero de una vez. Se borra y se reescribe porque el orden
   * y las secciones cambian a la vez que el texto, y reconciliar fila a fila no
   * aporta nada: las respuestas ya dadas viven en meeting_answers, no aquí.
   */
  app.put('/api/meeting-templates/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = z
      .object({
        name: z.string().min(1).optional(),
        description: nStr,
        questions: z.array(
          z.object({
            section: z.string().min(1),
            section_hint: nStr,
            question: z.string().min(1),
            is_core: z.boolean().optional(),
          })
        ),
      })
      .parse(req.body);

    const tpl = await one(`select id from meeting_templates where id = $1`, [id]);
    if (!tpl) {
      reply.code(404);
      return { error: 'template not found' };
    }

    await q(
      `update meeting_templates
          set name = coalesce($2, name), description = $3, updated_at = now()
        where id = $1`,
      [id, b.name ?? null, b.description ?? null]
    );
    await q(`delete from meeting_template_questions where template_id = $1`, [id]);
    for (const [i, qu] of b.questions.entries()) {
      await q(
        `insert into meeting_template_questions
           (template_id, section, section_hint, question, is_core, position)
         values ($1, $2, $3, $4, $5, $6)`,
        [id, qu.section, qu.section_hint ?? null, qu.question, !!qu.is_core, i + 1]
      );
    }
    return { ok: true, questions: b.questions.length };
  });

  /* ------------------------------------------------------------- reuniones */

  /**
   * Las reuniones del sprint, y además la última de cada persona en sprints
   * anteriores: en un 1:1 lo primero que quieres tener delante es lo que te
   * dijeron la última vez.
   */
  app.get('/api/sprints/:id/meetings', async (req) => {
    const { id } = req.params as { id: string };
    const own = await q(
      `select m.*, u.name as user_name,
              (select count(*) from meeting_answers a where a.meeting_id = m.id)                         as questions,
              (select count(*) from meeting_answers a
                where a.meeting_id = m.id and coalesce(trim(a.answer), '') <> '')                        as answered
         from meetings m left join users u on u.id = m.user_id
        where m.sprint_id = $1
        order by m.kind, u.name nulls last, m.created_at`,
      [id]
    );

    const previous = await q(
      `select distinct on (m.user_id, m.kind)
              m.id, m.kind, m.user_id, m.sprint_id, m.held_on, s.name as sprint_name
         from meetings m
         join sprints s on s.id = m.sprint_id
        where m.sprint_id <> $1 and m.user_id is not null
        order by m.user_id, m.kind, coalesce(s.start_date, '1900-01-01') desc, m.created_at desc`,
      [id]
    );
    return { own, previous };
  });

  app.get('/api/meetings/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const m = await one<any>(
      `select m.*, u.name as user_name, s.name as sprint_name
         from meetings m
         left join users u on u.id = m.user_id
         join sprints s on s.id = m.sprint_id
        where m.id = $1`,
      [id]
    );
    if (!m) {
      reply.code(404);
      return { error: 'meeting not found' };
    }
    m.answers = await answersOf(id);
    return m;
  });

  /**
   * Crear una reunión copia las preguntas de la plantilla. A partir de aquí la
   * reunión es independiente: editar la plantilla no la toca.
   */
  app.post('/api/sprints/:id/meetings', async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = z
      .object({
        kind: z.string().min(1).default('1on1'),
        user_id: nStr,
        template_id: nStr,
        held_on: nStr,
      })
      .parse(req.body ?? {});

    const tpl = b.template_id
      ? await one<any>(`select * from meeting_templates where id = $1`, [b.template_id])
      : await one<any>(
          `select * from meeting_templates where kind = $1 order by is_default desc limit 1`,
          [b.kind]
        );

    const meeting = await one<{ id: string }>(
      `insert into meetings (sprint_id, kind, user_id, template_id, held_on)
       values ($1, $2, $3, $4, $5::date) returning id`,
      [id, b.kind, b.user_id ?? null, tpl?.id ?? null, b.held_on ?? null]
    );

    if (tpl) {
      await q(
        `insert into meeting_answers (meeting_id, section, section_hint, question, is_core, position)
         select $1, section, section_hint, question, is_core, position
           from meeting_template_questions where template_id = $2 order by position`,
        [meeting!.id, tpl.id]
      );
    }

    reply.code(201);
    const full = await one<any>(`select * from meetings where id = $1`, [meeting!.id]);
    full.answers = await answersOf(meeting!.id);
    return full;
  });

  /** Guarda respuestas y cabecera. Las respuestas se actualizan por id. */
  app.put('/api/meetings/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = z
      .object({
        held_on: nStr,
        status: z.enum(['draft', 'held']).optional(),
        notes: nStr,
        answers: z
          .array(z.object({ id: z.string().uuid(), answer: nStr }))
          .optional(),
        // pregunta suelta añadida solo a esta reunión
        extra: z
          .array(
            z.object({
              section: z.string().min(1),
              question: z.string().min(1),
              answer: nStr,
            })
          )
          .optional(),
      })
      .parse(req.body ?? {});

    const m = await one<any>(`select * from meetings where id = $1`, [id]);
    if (!m) {
      reply.code(404);
      return { error: 'meeting not found' };
    }

    await q(
      `update meetings
          set held_on = coalesce($2::date, held_on),
              status  = coalesce($3, status),
              notes   = $4,
              updated_at = now()
        where id = $1`,
      [id, b.held_on ?? null, b.status ?? null, b.notes ?? null]
    );

    for (const a of b.answers ?? []) {
      await q(`update meeting_answers set answer = $2 where id = $1 and meeting_id = $3`, [
        a.id,
        a.answer ?? null,
        id,
      ]);
    }

    if (b.extra?.length) {
      const last = await one<{ n: number }>(
        `select coalesce(max(position), 0) as n from meeting_answers where meeting_id = $1`,
        [id]
      );
      for (const [i, e] of b.extra.entries()) {
        await q(
          `insert into meeting_answers (meeting_id, section, question, answer, position)
           values ($1, $2, $3, $4, $5)`,
          [id, e.section, e.question, e.answer ?? null, (last?.n ?? 0) + i + 1]
        );
      }
    }

    const full = await one<any>(
      `select m.*, u.name as user_name from meetings m
         left join users u on u.id = m.user_id where m.id = $1`,
      [id]
    );
    full.answers = await answersOf(id);
    return full;
  });

  app.delete('/api/meetings/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    await q(`delete from meetings where id = $1`, [id]);
    reply.code(204);
  });
}
