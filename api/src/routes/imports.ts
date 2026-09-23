import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { q } from '../db.js';

const row = z.object({
  issue_key: z.string().min(1),
  /** Jira imputa en subtareas; si la subtarea no está en el sprint se prueba el padre. */
  parent_key: z.union([z.string(), z.null()]).optional(),
  /** Resumen de la incidencia en Jira; sirve para rellenar títulos vacíos. */
  issue_summary: z.union([z.string(), z.null()]).optional(),
  /** Estimación original de la incidencia, en horas. */
  original_estimate: z.union([z.number(), z.null()]).optional(),
  /** Trabajo que Jira considera pendiente, en horas. Señal de avance real. */
  remaining_estimate: z.union([z.number(), z.null()]).optional(),
  author: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hours: z.number().positive(),
  comment: z.union([z.string(), z.null()]).optional(),
  /** Id de worklog de Jira, si el export lo trae. Permite dedup exacta. */
  external_id: z.union([z.string(), z.null()]).optional(),
  /** Marca de tiempo original del apunte, sólo para afinar la deduplicación. */
  source_ts: z.union([z.string(), z.null()]).optional(),
});

const body = z.object({
  dry_run: z.boolean().optional(),
  rows: z.array(row),
  /** nombre de autor en el CSV -> id de usuario de la aplicación */
  user_map: z.record(z.string()),
  /** Rellenar el título de las tareas que no tengan, con el resumen de Jira. */
  fill_titles: z.boolean().optional(),
  /** Rellenar la estimación en horas de las tareas que no tengan. */
  fill_estimates: z.boolean().optional(),
  /** Refrescar el trabajo restante de Jira. Es un valor vivo: siempre se pisa. */
  sync_remaining: z.boolean().optional(),
});

const norm = (s: string) => s.trim().toUpperCase();
const round2 = (n: number) => Math.round(n * 100) / 100;

/** "[DEV] Exportar guías" -> "Exportar guías". Sólo quita el prefijo. */
const cleanTitle = (s: string) => s.trim().replace(/^\[\s*dev\s*\]\s*/i, '').trim();

export default async function importRoutes(app: FastifyInstance) {
  /**
   * Importa worklogs de Jira contra las tareas de un sprint.
   *
   * Deduplicación en dos niveles:
   *  1. external_id (id de worklog de Jira) -> exacta, la refuerza un índice único.
   *  2. Sin id -> se cuenta cuántas dedicaciones idénticas (tarea, persona, fecha,
   *     horas) hay ya en la base y cuántas trae el fichero, e inserta sólo la
   *     diferencia. Así reimportar el mismo CSV no añade nada, pero dos worklogs
   *     legítimamente iguales el mismo día sí se conservan los dos.
   */
  app.post('/api/sprints/:id/import/worklogs', async (req) => {
    const { id } = req.params as { id: string };
    const b = body.parse(req.body);

    const tasks = await q<{ uid: string; key: string; title: string | null }>(
      `select uid, key, title from tasks where sprint_id = $1`,
      [id]
    );
    const taskByKey = new Map(tasks.map((t) => [norm(t.key), t.uid]));
    const keyByUid = new Map(tasks.map((t) => [t.uid, t.key]));
    const needsTitle = new Set(tasks.filter((t) => !t.title?.trim()).map((t) => t.uid));

    // Título propuesto para cada tarea sin título. Se toma del resumen de la fila,
    // que en las subtareas DEV describe justo el trabajo hecho. Se recoge aunque
    // la fila luego se descarte por persona: el título no depende de quién impute.
    const titleFor = new Map<string, string>();

    // Estimaciones por incidencia de Jira, deduplicadas: el CSV repite la misma
    // subtarea en cada apunte. Luego se suman las subtareas que cuelgan de la
    // misma tarea del sprint, porque una tarea puede tener varias subtareas DEV.
    const estimateByIssue = new Map<
      string,
      { orig: number | null; rem: number | null; summary: string | null }
    >();
    const issuesOfTask = new Map<string, Set<string>>();


    /**
     * Estimación y trabajo restante de una tarea a partir de sus incidencias.
     *
     * El equipo estima en la subtarea DEV, así que esa es la que vale. Sumar
     * todas las subtareas metería dentro el UAT y la análisis, inflando la
     * estimación de desarrollo (una tarea con DEV 16 h y UAT 4 h saldría a 20 h).
     * Sólo si no hay ninguna subtarea DEV se recurre a la suma.
     */
    const esDev = (sum: string | null) => /^\s*\[\s*dev\s*\]/i.test(sum ?? '');

    const resolverEstimacion = (issues: Set<string>) => {
      const entradas = [...issues]
        .map((k) => estimateByIssue.get(k))
        .filter((e): e is NonNullable<typeof e> => !!e);

      const dev = entradas.filter((e) => esDev(e.summary));
      const fuente = dev.length ? dev : entradas;

      let orig: number | null = null;
      let rem: number | null = null;
      for (const e of fuente) {
        if (e.orig != null) orig = (orig ?? 0) + e.orig;
        if (e.rem != null) rem = (rem ?? 0) + e.rem;
      }
      return { orig, rem, fromDev: dev.length > 0 };
    };

    const users = await q<{ id: string }>(`select id from users`);
    const userIds = new Set(users.map((u) => u.id));

    type Resolved = {
      task_uid: string;
      user_id: string;
      date: string;
      hours: number;
      comment: string | null;
      external_id: string | null;
      source_ts: string | null;
      issue_key: string;
      matched_key: string;
      via_parent: boolean;
      author: string;
    };

    const resolved: Resolved[] = [];
    const unknownTasks = new Map<string, { rows: number; hours: number; parent: string | null }>();
    const unknownAuthors = new Map<string, { rows: number; hours: number }>();
    const viaParent = new Map<string, { rows: number; hours: number; parent: string }>();

    for (const r of b.rows) {
      // La subtarea manda; si no está en el sprint, se prueba con su tarea padre.
      let uid = taskByKey.get(norm(r.issue_key));
      let matchedKey = r.issue_key;
      let usedParent = false;

      if (!uid && r.parent_key?.trim()) {
        const puid = taskByKey.get(norm(r.parent_key));
        if (puid) {
          uid = puid;
          matchedKey = r.parent_key.trim();
          usedParent = true;
        }
      }

      const mapped = b.user_map[r.author];

      if (!uid) {
        // Se informa también del padre: normalmente es lo que hay que meter en el
        // sprint para recuperar esas horas (ceremonias, gestión…).
        const cur = unknownTasks.get(r.issue_key) ?? { rows: 0, hours: 0, parent: null };
        unknownTasks.set(r.issue_key, {
          rows: cur.rows + 1,
          hours: round2(cur.hours + r.hours),
          parent: r.parent_key?.trim() || cur.parent,
        });
        continue;
      }
      if (!estimateByIssue.has(r.issue_key)) {
        estimateByIssue.set(r.issue_key, {
          orig: r.original_estimate ?? null,
          rem: r.remaining_estimate ?? null,
          summary: r.issue_summary ?? null,
        });
      }
      if (!issuesOfTask.has(uid)) issuesOfTask.set(uid, new Set());
      issuesOfTask.get(uid)!.add(r.issue_key);

      if (b.fill_titles && needsTitle.has(uid) && !titleFor.has(uid)) {
        const t = cleanTitle(r.issue_summary ?? '');
        if (t) titleFor.set(uid, t);
      }

      if (!mapped || !userIds.has(mapped)) {
        const cur = unknownAuthors.get(r.author) ?? { rows: 0, hours: 0 };
        unknownAuthors.set(r.author, { rows: cur.rows + 1, hours: round2(cur.hours + r.hours) });
        continue;
      }

      if (usedParent) {
        const cur = viaParent.get(r.issue_key) ?? { rows: 0, hours: 0, parent: matchedKey };
        viaParent.set(r.issue_key, {
          rows: cur.rows + 1,
          hours: round2(cur.hours + r.hours),
          parent: matchedKey,
        });
      }

      resolved.push({
        task_uid: uid,
        user_id: mapped,
        date: r.date,
        hours: r.hours,
        comment: r.comment ?? null,
        external_id: r.external_id?.trim() || null,
        source_ts: r.source_ts?.trim() || null,
        issue_key: r.issue_key,
        matched_key: matchedKey,
        via_parent: usedParent,
        author: r.author,
      });
    }

    /* ---------------------------------------------- 1. dedup por id de worklog */

    const withId = resolved.filter((r) => r.external_id);
    const withoutId = resolved.filter((r) => !r.external_id);

    const seenIds = new Set<string>();
    const newWithId: Resolved[] = [];
    let duplicatesById = 0;

    if (withId.length) {
      const ids = [...new Set(withId.map((r) => r.external_id!))];
      const existing = await q<{ external_id: string }>(
        `select external_id from dedications where external_id = any($1::text[])`,
        [ids]
      );
      const already = new Set(existing.map((e) => e.external_id));
      for (const r of withId) {
        // duplicado si ya está en la base o si el propio fichero lo repite
        if (already.has(r.external_id!) || seenIds.has(r.external_id!)) {
          duplicatesById++;
          continue;
        }
        seenIds.add(r.external_id!);
        newWithId.push(r);
      }
    }

    /* ------------------------------------------- 2. dedup por huella (sin id) */

    // La marca de tiempo, cuando el export la trae, entra en la huella: distingue
    // dos apuntes idénticos hechos a distinta hora del mismo día.
    const groups = new Map<string, Resolved[]>();
    for (const r of withoutId) {
      const k = `${r.task_uid}|${r.user_id}|${r.date}|${r.hours}|${r.source_ts ?? ''}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(r);
    }

    const newWithoutId: Resolved[] = [];
    let duplicatesByFingerprint = 0;

    for (const [, rows] of groups) {
      const first = rows[0];
      const existing = await q<{ n: number }>(
        `select count(*)::int as n from dedications
         where task_uid = $1 and user_id = $2 and date = $3 and hours = $4
           and external_id is null
           and source_ts is not distinct from $5`,
        [first.task_uid, first.user_id, first.date, first.hours, first.source_ts]
      );
      const already = existing[0]?.n ?? 0;
      const toAdd = Math.max(rows.length - already, 0);
      duplicatesByFingerprint += rows.length - toAdd;
      newWithoutId.push(...rows.slice(0, toAdd));
    }

    const toInsert = [...newWithId, ...newWithoutId];

    /* -------------------------------- estimación y trabajo restante desde Jira */

    // Se suman las subtareas que cuelgan de la misma tarea del sprint: una tarea
    // puede tener varias subtareas DEV, cada una con su estimación.
    const currentTasks = await q<{ uid: string; estimate_hours: number | null; remaining_hours: number | null }>(
      `select uid, estimate_hours, remaining_hours from tasks where sprint_id = $1`,
      [id]
    );
    const byUid = new Map(currentTasks.map((t) => [t.uid, t]));

    const estimateChanges: {
      key: string; estimate: number | null; remaining: number | null;
      current: number | null; fills: boolean;
    }[] = [];

    for (const [uid, issues] of issuesOfTask) {
      const { orig, rem } = resolverEstimacion(issues);
      if (orig == null && rem == null) continue;
      const cur = byUid.get(uid);
      estimateChanges.push({
        key: keyByUid.get(uid)!,
        estimate: orig == null ? null : round2(orig),
        remaining: rem == null ? null : round2(rem),
        current: cur?.estimate_hours ?? null,
        fills: cur?.estimate_hours == null && orig != null,
      });
    }
    estimateChanges.sort((a, b) => a.key.localeCompare(b.key));

    /* ------------------------------------------------------------- resultado */

    const byUser = new Map<string, { rows: number; hours: number }>();
    const byTask = new Map<string, { rows: number; hours: number }>();
    for (const r of toInsert) {
      const u = byUser.get(r.user_id) ?? { rows: 0, hours: 0 };
      byUser.set(r.user_id, { rows: u.rows + 1, hours: round2(u.hours + r.hours) });
      const t = byTask.get(r.matched_key) ?? { rows: 0, hours: 0 };
      byTask.set(r.matched_key, { rows: t.rows + 1, hours: round2(t.hours + r.hours) });
    }

    const summary = {
      received: b.rows.length,
      toImport: toInsert.length,
      hoursToImport: round2(toInsert.reduce((a, r) => a + r.hours, 0)),
      duplicates: duplicatesById + duplicatesByFingerprint,
      duplicatesById,
      duplicatesByFingerprint,
      dedupMode: withId.length
        ? withoutId.length
          ? ('mixed' as const)
          : ('external_id' as const)
        : ('fingerprint' as const),
      unknownTasks: [...unknownTasks]
        .map(([issue_key, v]) => ({ issue_key, ...v }))
        .sort((a, b) => b.hours - a.hours),
      // Horas descartadas agrupadas por tarea padre: meter ese padre en el sprint
      // es lo que las recupera (el caso típico son las ceremonias).
      unknownParents: [...
        [...unknownTasks].reduce((m, [issue_key, v]) => {
          const k = v.parent ?? issue_key;
          const cur = m.get(k) ?? { rows: 0, hours: 0, children: [] as string[] };
          m.set(k, {
            rows: cur.rows + v.rows,
            hours: round2(cur.hours + v.hours),
            children: v.parent ? [...cur.children, issue_key] : cur.children,
          });
          return m;
        }, new Map<string, { rows: number; hours: number; children: string[] }>()),
      ]
        .map(([key, v]) => ({ key, ...v }))
        .sort((a, b) => b.hours - a.hours),
      unknownAuthors: [...unknownAuthors].map(([author, v]) => ({ author, ...v })),
      // subtareas cuyo esfuerzo se ha sumado a la tarea padre del sprint
      viaParent: [...viaParent]
        .map(([issue_key, v]) => ({ issue_key, ...v }))
        .sort((a, b) => b.hours - a.hours),
      viaParentRows: resolved.filter((r) => r.via_parent).length,
      byUser: [...byUser].map(([user_id, v]) => ({ user_id, ...v })).sort((a, b) => b.hours - a.hours),
      byTask: [...byTask].map(([issue_key, v]) => ({ issue_key, ...v })).sort((a, b) => b.hours - a.hours),
      sample: toInsert.slice(0, 10).map((r) => ({
        issue_key: r.matched_key,
        author: r.author,
        user_id: r.user_id,
        date: r.date,
        hours: r.hours,
        comment: r.comment,
      })),
      titles: [...titleFor].map(([uid, title]) => ({ key: keyByUid.get(uid)!, title })),
      estimates: estimateChanges,
      dry_run: !!b.dry_run,
      imported: 0,
      titlesSet: 0,
      notesUpdated: 0,
      estimatesSet: 0,
      remainingSynced: 0,
    };

    if (b.dry_run) return summary;

    for (const r of toInsert) {
      await q(
        `insert into dedications (task_uid, user_id, hours, date, note, external_id, source_ts, source)
         values ($1,$2,$3,$4,$5,$6,$7,'jira')
         on conflict (external_id) where external_id is not null do nothing`,
        [r.task_uid, r.user_id, r.hours, r.date, r.comment, r.external_id, r.source_ts]
      );
    }

    // Los duplicados no se insertan, pero su descripción puede haber cambiado en
    // Jira desde la última importación. Se refresca cuando la coincidencia es
    // inequívoca: por id de worklog, o por huella cuando sólo hay una a cada lado.
    for (const r of withId) {
      if (r.comment === null) continue;
      const res = await q(
        `update dedications set note = $2
         where external_id = $1 and note is distinct from $2
         returning id`,
        [r.external_id, r.comment]
      );
      summary.notesUpdated += res.length;
    }

    for (const [, rows] of groups) {
      if (rows.length !== 1) continue;
      const r = rows[0];
      if (r.comment === null) continue;
      const res = await q(
        `update dedications set note = $5
         where task_uid = $1 and user_id = $2 and date = $3 and hours = $4
           and external_id is null and source_ts is not distinct from $6
           and note is distinct from $5
         returning id`,
        [r.task_uid, r.user_id, r.date, r.hours, r.comment, r.source_ts]
      );
      summary.notesUpdated += res.length;
    }

    for (const [uid, issues] of issuesOfTask) {
      const { orig, rem } = resolverEstimacion(issues);

      // Esta estimación es la de la SUBTAREA DEV, que es la que vale para el
      // equipo. Rellena las vacías y mejora las que vinieron de la tarea padre,
      // pero nunca pisa una escrita a mano.
      if (b.fill_estimates && orig != null) {
        const res = await q(
          `update tasks set estimate_hours = $2, estimate_source = 'dev_subtask', updated_at = now()
           where uid = $1
             and (estimate_hours is null or estimate_source = 'parent')
           returning uid`,
          [uid, round2(orig)]
        );
        summary.estimatesSet += res.length;
      }

      // El restante es un valor vivo de Jira: siempre se refresca.
      if (b.sync_remaining && rem != null) {
        const res = await q(
          `update tasks set remaining_hours = $2, remaining_synced_at = now()
           where uid = $1 and remaining_hours is distinct from $2::numeric returning uid`,
          [uid, round2(rem)]
        );
        summary.remainingSynced += res.length;
      }
    }

    // Sólo se rellena lo que siga vacío: nunca pisa un título escrito a mano.
    for (const [uid, title] of titleFor) {
      const res = await q(
        `update tasks set title = $2, updated_at = now()
         where uid = $1 and (title is null or btrim(title) = '')
         returning uid`,
        [uid, title]
      );
      summary.titlesSet += res.length;
    }

    summary.imported = toInsert.length;
    return summary;
  });
}
