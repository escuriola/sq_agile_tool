import type { FastifyInstance } from 'fastify';
import { q, one } from '../db.js';

type Sprint = {
  id: string; name: string; start_date: string | null; end_date: string | null;
  goal: string | null; status: string; discovery_ratio: number; commit_factor: number;
};

type TaskRow = {
  uid: string; key: string; project_id: string; title: string | null; type: string;
  track: string;
  status: string; blocked: boolean; estimate_points: number | null; estimate_hours: number | null;
  remaining_hours: number | null; remaining_synced_at: string | null;
  priority: string | null; component: string | null; epic: string | null;
  jira_status: string | null; jira_created_at: string | null; jira_resolved_at: string | null;
  sprint_count: number | null; blocked_by: string[] | null; total_time_spent: number | null;
  assignee_id: string | null; added_after_start: boolean; completed_at: string | null;
  logged_hours: number;
};

type DedRow = {
  user_id: string; hours: number; date: string; project_id: string; task_key: string; track: string;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (isoDate: string, n: number) => {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};
const isWeekend = (isoDate: string) => {
  const wd = new Date(isoDate + 'T00:00:00Z').getUTCDay();
  return wd === 0 || wd === 6;
};
const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = start;
  let guard = 0;
  while (cur <= end && guard++ < 400) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

/**
 * Todo el cálculo de métricas de un sprint. Se extrae de la ruta para que el
 * generador de informes lo reutilice tal cual, en vez de duplicar reglas.
 * Devuelve null si el sprint no existe.
 */
export async function computeMetrics(id: string) {


    const sprint = await one<Sprint>(`select * from sprints where id = $1`, [id]);
    if (!sprint) return null;




    const tasks = await q<TaskRow>(
      `select t.uid, t.key, t.project_id, t.title, t.type, t.track, t.status, t.blocked,
              t.remaining_hours, t.remaining_synced_at,
              t.priority, t.component, t.epic, t.jira_status, t.jira_created_at,
              t.jira_resolved_at, t.sprint_count, t.blocked_by, t.total_time_spent,
              t.estimate_points, t.estimate_hours, t.assignee_id,
              t.added_after_start, t.completed_at,
              coalesce((select sum(d.hours) from dedications d where d.task_uid = t.uid), 0) as logged_hours
       from tasks t where t.sprint_id = $1`,
      [id]
    );

    const deds = await q<DedRow>(
      `select d.user_id, d.hours, d.date, t.project_id, t.key as task_key, t.track
       from dedications d join tasks t on t.uid = d.task_uid
       where t.sprint_id = $1
       order by d.date`,
      [id]
    );

    // La capacidad que manda es la del sprint; la del usuario sólo es el defecto.
    const users = await q<{
      id: string;
      name: string;
      active: boolean;
      capacity: number | null;
      has_override: boolean;
    }>(
      `select u.id, u.name, u.active,
              coalesce(sc.capacity_hours, u.capacity_hours) as capacity,
              (sc.user_id is not null) as has_override
       from users u
       left join sprint_capacities sc on sc.user_id = u.id and sc.sprint_id = $1`,
      [id]
    );
    const userName = new Map(users.map((u) => [u.id, u.name]));
    const userCap = new Map(users.map((u) => [u.id, u.capacity]));

    // Sólo cuenta para el total del equipo quien tenga capacidad > 0 en este sprint.
    const teamCapacity = sum(
      users.filter((u) => u.active || u.has_override).map((u) => u.capacity ?? 0)
    );
    const capacityIsSet = users.some((u) => (u.capacity ?? 0) > 0);

    const done = tasks.filter((t) => t.status === 'done');

    // Fecha de cierre efectiva: la de Jira manda sobre la local, porque marcar una
    // tarea aquí pone la fecha de hoy y eso hunde el burndown de golpe el último día.
    const cierre = (t: TaskRow) => t.jira_resolved_at ?? t.completed_at;
    const pts = (t: TaskRow) => t.estimate_points ?? 0;
    const est = (t: TaskRow) => t.estimate_hours ?? 0;

    const committed = tasks.filter((t) => !t.added_after_start);
    const added = tasks.filter((t) => t.added_after_start);

    const committedPoints = sum(committed.map(pts));
    const addedPoints = sum(added.map(pts));
    const totalPoints = committedPoints + addedPoints;
    const completedPoints = sum(done.map(pts));
    const estimateHours = sum(tasks.map(est));
    const loggedHours = sum(tasks.map((t) => t.logged_hours));

    const spillover = tasks.filter((t) => t.status !== 'done');

    // Tareas con estimación en horas y esfuerzo registrado: precisión de estimación
    const comparable = tasks.filter((t) => est(t) > 0 && t.logged_hours > 0);
    const outliers = comparable
      .map((t) => ({
        key: t.key,
        title: t.title,
        project_id: t.project_id,
        estimate_hours: est(t),
        logged_hours: round(t.logged_hours),
        delta: round(t.logged_hours - est(t)),
        ratio: round(t.logged_hours / est(t)),
      }))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 12);

    /* ---------------------------------------------- desviación de tiempo */

    // Sólo tiene sentido comparar en tareas cerradas: en una abierta el "exceso"
    // aún puede ser trabajo legítimo pendiente de terminar.
    const doneComparable = done.filter((t) => est(t) > 0);
    const estimateDone = sum(doneComparable.map(est));
    const loggedDone = sum(doneComparable.map((t) => t.logged_hours));

    const conDesvio = (ts: TaskRow[]) =>
      ts.map((t) => ({
        key: t.key,
        title: t.title,
        project_id: t.project_id,
        status: t.status,
        assignee_id: t.assignee_id,
        estimate_hours: est(t),
        logged_hours: round(t.logged_hours),
        delta: round(t.logged_hours - est(t)),
        ratio: est(t) ? round(t.logged_hours / est(t)) : null,
      }));

    const desviadas = conDesvio(doneComparable);
    const pasadas = desviadas.filter((d) => d.delta > 0).sort((a, b) => b.delta - a.delta);
    const holgadas = desviadas.filter((d) => d.delta < 0).sort((a, b) => a.delta - b.delta);

    // En curso ya por encima de lo estimado: aviso temprano, no desviación cerrada.
    const abiertasPasadas = conDesvio(
      tasks.filter((t) => t.status !== 'done' && est(t) > 0 && t.logged_hours > est(t))
    ).sort((a, b) => b.delta - a.delta);

    const deviation = {
      tasksCompared: doneComparable.length,
      estimateDone: round(estimateDone),
      loggedDone: round(loggedDone),
      // el número que pedía: cuánto se desvía el tiempo en total
      deltaDone: round(loggedDone - estimateDone),
      deviationPct: estimateDone ? round(((loggedDone - estimateDone) / estimateDone) * 100, 1) : null,
      // los excesos y las holguras no se compensan: interesan por separado
      overrunHours: round(sum(pasadas.map((d) => d.delta))),
      underrunHours: round(Math.abs(sum(holgadas.map((d) => d.delta)))),
      overrunTasks: pasadas.length,
      underrunTasks: holgadas.length,
      onTargetTasks: desviadas.filter((d) => d.delta === 0).length,
      openOverrunHours: round(sum(abiertasPasadas.map((d) => d.delta))),
      openOverrunTasks: abiertasPasadas.length,
      worstOverrun: pasadas.slice(0, 10),
      worstUnderrun: holgadas.slice(0, 10),
      openOverrun: abiertasPasadas.slice(0, 10),
    };

    /* ------------------------ velocidad real y previsión de compromiso */

    // "Velocidad real" del equipo: horas ESTIMADAS de lo que se ha cerrado. No es
    // lo que se ha trabajado (eso son las horas imputadas), es el tamaño del
    // trabajo entregado medido con la misma vara con la que se planifica.
    const deliveredEstimate = sum(done.map(est));
    const committedEstimate = estimateHours;

    // Reparto por tamaño de estimación: cuántas tareas de 4 h, de 8 h, de 16 h…
    // se han cerrado. Dice qué tamaño de tarea fluye y cuál se atasca.
    const sizes = new Map<number, { total: number; done: number; deliveredHours: number }>();
    for (const t of tasks) {
      const e = est(t);
      const cur = sizes.get(e) ?? { total: 0, done: 0, deliveredHours: 0 };
      cur.total += 1;
      if (t.status === 'done') {
        cur.done += 1;
        cur.deliveredHours += e;
      }
      sizes.set(e, cur);
    }
    const doneByEstimate = [...sizes]
      .map(([estimate, v]) => ({
        estimate,
        total: v.total,
        done: v.done,
        open: v.total - v.done,
        deliveredHours: round(v.deliveredHours),
        pctDone: v.total ? round((v.done / v.total) * 100, 1) : 0,
      }))
      .sort((a, b) => a.estimate - b.estimate);

    const doneEstimates = done.map(est).filter((e) => e > 0).sort((a, b) => a - b);
    const median = (xs: number[]) =>
      xs.length ? (xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2) : null;

    // Cuánto cuesta de verdad una hora estimada. 0.59 = las tareas salen por el
    // 59% de lo estimado, o sea que se sobrestima.
    const estimateFactor = estimateDone ? round(loggedDone / estimateDone, 3) : null;

    const velocity = {
      tasksDone: done.length,
      tasksTotal: tasks.length,
      committedEstimate: round(committedEstimate),
      deliveredEstimate: round(deliveredEstimate),
      deliveryRatio: committedEstimate ? round((deliveredEstimate / committedEstimate) * 100, 1) : null,
      avgEstimateDone: doneEstimates.length ? round(sum(doneEstimates) / doneEstimates.length) : null,
      medianEstimateDone: median(doneEstimates),
      estimateFactor,
      loggedOnDone: round(loggedDone),
    };

    /**
     * Cuánta estimación se puede comprometer el sprint que viene. Se dan tres
     * lecturas porque miden cosas distintas y conviene verlas juntas:
     *
     *  - porVelocidad: lo que de verdad se cerró. Es la más fiable y la que se
     *    recomienda, porque ya lleva dentro los bloqueos, las interrupciones y
     *    todo lo que no se planifica.
     *  - porHorasEsperadas: capacidad de delivery por la utilización observada,
     *    convertida a horas estimadas. Suele salir más alta: supone que todo el
     *    tiempo trabajado acaba cerrando tareas.
     *  - techoDeCapacidad: el máximo teórico si se aprovechara toda la capacidad.
     *    No es un objetivo, es el límite que no se puede pasar.
     */
    const commitFactor = Number(sprint.commit_factor ?? 1);
    const deliveryCapacity0 = teamCapacity * (1 - Number(sprint.discovery_ratio ?? 0.2));
    const utilFrac = teamCapacity ? loggedHours / teamCapacity : 0;

    const porVelocidad = round(deliveredEstimate * commitFactor);
    const porHorasEsperadas =
      estimateFactor && estimateFactor > 0
        ? round((deliveryCapacity0 * utilFrac * commitFactor) / estimateFactor)
        : null;
    const techoDeCapacidad =
      estimateFactor && estimateFactor > 0 ? round(deliveryCapacity0 / estimateFactor) : null;

    const forecast = {
      commitFactor,
      deliveryCapacity: capacityIsSet ? round(deliveryCapacity0) : null,
      utilisation: capacityIsSet ? round(utilFrac * 100, 1) : null,
      estimateFactor,
      byVelocity: porVelocidad,
      byExpectedHours: capacityIsSet ? porHorasEsperadas : null,
      capacityCeiling: capacityIsSet ? techoDeCapacidad : null,
      // la recomendación es la empírica: es la única que ya incluye la fricción real
      recommended: porVelocidad,
      equivalentTasks: velocity.avgEstimateDone
        ? Math.round(porVelocidad / velocity.avgEstimateDone)
        : null,
    };


    /* --------------------------------- datos que sólo trae el export de Jira */

    const withJira = tasks.filter((t) => t.jira_status);

    // Lo más accionable: dónde no coincide el estado de aquí con el de Jira.
    const statusDivergence = withJira
      .map((t) => ({
        key: t.key,
        title: t.title,
        project_id: t.project_id,
        appStatus: t.status,
        jiraStatus: t.jira_status!,
        resolved: t.jira_resolved_at,
      }))
      .sort((a, b) => a.jiraStatus.localeCompare(b.jiraStatus));

    // Arrastre real: en cuántos sprints ha estado la tarea, según Jira.
    const carried = tasks
      .filter((t) => (t.sprint_count ?? 0) > 1)
      .map((t) => ({
        key: t.key,
        title: t.title,
        project_id: t.project_id,
        sprints: t.sprint_count!,
        estimate_hours: est(t),
        logged_hours: round(t.logged_hours),
      }))
      .sort((a, b) => b.sprints - a.sprints);

    // Bloqueos declarados en Jira (flag o enlaces de bloqueo).
    const impediments = tasks
      .filter((t) => t.blocked || (t.blocked_by?.length ?? 0) > 0)
      .map((t) => ({
        key: t.key,
        title: t.title,
        project_id: t.project_id,
        flagged: t.blocked,
        blockedBy: t.blocked_by ?? [],
      }));

    // Antigüedad: cuánto lleva viva la tarea desde que se creó en Jira.
    const hoyIso = iso(new Date());
    const ageDays = (d: string) => Math.round((Date.parse(hoyIso) - Date.parse(d)) / 86400000);
    const oldest = tasks
      .filter((t) => t.jira_created_at && t.status !== 'done')
      .map((t) => ({
        key: t.key,
        title: t.title,
        project_id: t.project_id,
        created: t.jira_created_at!,
        ageDays: ageDays(t.jira_created_at!),
      }))
      .sort((a, b) => b.ageDays - a.ageDays)
      .slice(0, 8);

    const dimension = (pick: (t: TaskRow) => string | null) => {
      const m = new Map<string, { tasks: number; estimate: number; hours: number }>();
      for (const t of tasks) {
        const k = pick(t);
        if (!k) continue;
        const cur = m.get(k) ?? { tasks: 0, estimate: 0, hours: 0 };
        m.set(k, {
          tasks: cur.tasks + 1,
          estimate: cur.estimate + est(t),
          hours: cur.hours + t.logged_hours,
        });
      }
      return [...m].map(([key, v]) => ({
        key,
        tasks: v.tasks,
        estimate: round(v.estimate),
        hours: round(v.hours),
      })).sort((a, b) => b.hours - a.hours || b.estimate - a.estimate);
    };

    // Σ Time Spent de Jira es histórico y de todo el mundo (UAT, análisis…),
    // no las horas de este sprint: sólo sirve para ver el peso del no-desarrollo.
    const jiraLifetimeHours = sum(tasks.map((t) => t.total_time_spent ?? 0));

    /* ------------------------------- avance real segun el restante de Jira */

    // El "remaining estimate" de Jira es la única señal de avance que se importa
    // sola. Vale más que el estado cuando nadie actualiza estados a mano.
    const withRemaining = tasks.filter((t) => t.remaining_hours != null);
    const remainingHours = sum(withRemaining.map((t) => t.remaining_hours!));
    const estimateOfTracked = sum(withRemaining.map(est));

    // Terminadas segun Jira pero sin cerrar aquí: candidatas a marcar como DONE.
    const readyToClose = withRemaining
      .filter((t) => t.remaining_hours === 0 && t.status !== 'done')
      .map((t) => ({
        key: t.key,
        title: t.title,
        project_id: t.project_id,
        status: t.status,
        estimate_hours: est(t),
        logged_hours: round(t.logged_hours),
      }));

    // Consumo: cuánto de la estimación se ha gastado ya. >100% es sobrecoste real.
    const burn = tasks
      .filter((t) => est(t) > 0 && t.logged_hours > 0)
      .map((t) => ({
        key: t.key,
        title: t.title,
        project_id: t.project_id,
        estimate_hours: est(t),
        logged_hours: round(t.logged_hours),
        remaining_hours: t.remaining_hours,
        consumed: round((t.logged_hours / est(t)) * 100, 1),
      }))
      .sort((a, b) => b.consumed - a.consumed);

    // En riesgo: consumido más del 80% y Jira sigue diciendo que queda trabajo.
    const atRisk = burn.filter(
      (t) => t.consumed >= 80 && (t.remaining_hours == null || t.remaining_hours > 0)
    );

    // Estancadas: tuvieron dedicación y llevan días sin tocarse pese a no estar cerradas.
    const lastTouch = new Map<string, string>();
    for (const d of deds) {
      const cur = lastTouch.get(d.task_key);
      if (!cur || d.date > cur) lastTouch.set(d.task_key, d.date);
    }
    const today = iso(new Date());
    const daysBetween = (a: string, b: string) =>
      Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
    const stalled = tasks
      .filter((t) => t.status !== 'done' && lastTouch.has(t.key))
      .map((t) => ({
        key: t.key,
        title: t.title,
        project_id: t.project_id,
        lastDate: lastTouch.get(t.key)!,
        idleDays: daysBetween(lastTouch.get(t.key)!, today),
        logged_hours: round(t.logged_hours),
      }))
      .filter((t) => t.idleDays >= 3)
      .sort((a, b) => b.idleDays - a.idleDays);

    // Dispersión: en cuántas tareas distintas ha tocado cada persona.
    const tasksPerUser = new Map<string, Set<string>>();
    for (const d of deds) {
      if (!tasksPerUser.has(d.user_id)) tasksPerUser.set(d.user_id, new Set());
      tasksPerUser.get(d.user_id)!.add(d.task_key);
    }

    /* ------------------------------------------------- delivery vs discovery */

    // El delivery es el commitment del sprint; el discovery se reserva un
    // porcentaje de la capacidad y ocupa lo que el delivery deje libre.
    const discoveryRatio = Number(sprint.discovery_ratio ?? 0.20);
    const deliveryCapacity = teamCapacity * (1 - discoveryRatio);
    const discoveryCapacity = teamCapacity * discoveryRatio;

    const trackRow = (name: 'delivery' | 'discovery', capacityForTrack: number) => {
      const ts = tasks.filter((t) => t.track === name);
      const dedHours = sum(deds.filter((d) => d.track === name).map((d) => d.hours));
      const estimated = sum(ts.map(est));
      const doneTs = ts.filter((t) => t.status === 'done');
      return {
        track: name,
        capacity: capacityIsSet ? round(capacityForTrack) : null,
        tasks: ts.length,
        tasksDone: doneTs.length,
        points: round(sum(ts.map(pts))),
        pointsDone: round(sum(doneTs.map(pts))),
        estimateHours: round(estimated),
        loggedHours: round(dedHours),
        // % de la capacidad de ESE carril que consume lo planificado
        plannedLoad: capacityIsSet && capacityForTrack ? round((estimated / capacityForTrack) * 100, 1) : null,
        // horas que sobran (o faltan, en negativo) dentro del carril
        remainingHours: capacityIsSet ? round(capacityForTrack - estimated) : null,
        // reparto real de las horas dedicadas entre los dos carriles
        shareOfLogged: loggedHours ? round((dedHours / loggedHours) * 100, 1) : null,
      };
    };

    const byTrack = [
      trackRow('delivery', deliveryCapacity),
      trackRow('discovery', discoveryCapacity),
    ];
    const delivery = byTrack[0];
    const discovery = byTrack[1];

    // Si el delivery se pasa de su parte, se come tiempo de discovery.
    const deliveryOverflow = capacityIsSet ? Math.max(delivery.estimateHours - deliveryCapacity, 0) : 0;

    /* ------------------------------------------------------------- agrupados */

    const groupBy = <K extends string>(rows: TaskRow[], key: (t: TaskRow) => K) => {
      const m = new Map<K, TaskRow[]>();
      for (const t of rows) {
        const k = key(t);
        if (!m.has(k)) m.set(k, []);
        m.get(k)!.push(t);
      }
      return m;
    };

    const byStatus = [...groupBy(tasks, (t) => t.status as any)].map(([status, ts]) => ({
      status,
      tasks: ts.length,
      points: round(sum(ts.map(pts))),
      hours: round(sum(ts.map((t) => t.logged_hours))),
    }));

    const byType = [...groupBy(tasks, (t) => t.type as any)].map(([type, ts]) => ({
      type,
      tasks: ts.length,
      points: round(sum(ts.map(pts))),
      hours: round(sum(ts.map((t) => t.logged_hours))),
      pctHours: 0,
    }));
    for (const r of byType) r.pctHours = loggedHours ? round((r.hours / loggedHours) * 100, 1) : 0;

    const byProject = [...groupBy(tasks, (t) => t.project_id as any)]
      .map(([project_id, ts]) => {
        const d = ts.filter((t) => t.status === 'done');
        return {
          project_id,
          tasks: ts.length,
          tasksDone: d.length,
          points: round(sum(ts.map(pts))),
          pointsDone: round(sum(d.map(pts))),
          estimateHours: round(sum(ts.map(est))),
          loggedHours: round(sum(ts.map((t) => t.logged_hours))),
        };
      })
      .sort((a, b) => b.loggedHours - a.loggedHours);

    const userHours = new Map<string, number>();
    for (const d of deds) userHours.set(d.user_id, (userHours.get(d.user_id) ?? 0) + d.hours);

    // Horas de cada persona en cada tarea, para separar lo propio de lo de apoyo.
    const hoursByUserTask = new Map<string, number>();
    const daysByUser = new Map<string, Map<string, number>>();
    for (const d of deds) {
      const k = `${d.user_id}||${d.task_key}`;
      hoursByUserTask.set(k, (hoursByUserTask.get(k) ?? 0) + d.hours);
      if (!daysByUser.has(d.user_id)) daysByUser.set(d.user_id, new Map());
      const dm = daysByUser.get(d.user_id)!;
      dm.set(d.date, (dm.get(d.date) ?? 0) + d.hours);
    }
    const taskByKey = new Map(tasks.map((t) => [t.key, t]));

    const byUser = [...new Set([...userHours.keys(), ...tasks.map((t) => t.assignee_id).filter(Boolean) as string[]])]
      .map((uid) => {
        const assigned = tasks.filter((t) => t.assignee_id === uid);
        const hours = round(userHours.get(uid) ?? 0);
        const capacity = userCap.get(uid) ?? null;

        // Reparto de SU tiempo entre tareas suyas y de otros.
        let ownHours = 0;
        let supportHours = 0;
        let topTaskHours = 0;
        let topTaskKey: string | null = null;
        for (const key of tasksPerUser.get(uid) ?? []) {
          const h = hoursByUserTask.get(`${uid}||${key}`) ?? 0;
          const owner = taskByKey.get(key)?.assignee_id ?? null;
          if (owner === uid) ownHours += h;
          else if (owner) supportHours += h;
          if (h > topTaskHours) {
            topTaskHours = h;
            topTaskKey = key;
          }
        }

        // Desviación sobre las tareas que son SUYAS y ya están cerradas.
        const ownDoneCmp = assigned.filter((t) => t.status === 'done' && est(t) > 0);
        const ownEstimate = sum(ownDoneCmp.map(est));
        const ownLogged = sum(ownDoneCmp.map((t) => t.logged_hours));

        const dm = daysByUser.get(uid);
        const dayVals = dm ? [...dm.values()] : [];
        const dayKeys = dm ? [...dm.keys()].sort() : [];

        return {
          user_id: uid,
          name: userName.get(uid) ?? uid,
          hours,
          capacity,
          utilization: capacity ? round((hours / capacity) * 100, 1) : null,
          distinctTasks: tasksPerUser.get(uid)?.size ?? 0,

          // ownership
          tasksAssigned: assigned.length,
          tasksDone: assigned.filter((t) => t.status === 'done').length,
          tasksInProgress: assigned.filter((t) => t.status !== 'done' && t.status !== 'todo').length,
          tasksBlocked: assigned.filter((t) => t.blocked).length,
          ownedEstimate: round(sum(assigned.map(est))),
          ownedLogged: round(sum(assigned.map((t) => t.logged_hours))),

          // desviación en lo suyo ya cerrado
          ownDoneTasks: ownDoneCmp.length,
          ownEstimateDone: round(ownEstimate),
          ownLoggedDone: round(ownLogged),
          ownDelta: round(ownLogged - ownEstimate),
          ownDeviationPct: ownEstimate ? round(((ownLogged - ownEstimate) / ownEstimate) * 100, 1) : null,

          // propio vs apoyo a otros
          ownHours: round(ownHours),
          supportHours: round(supportHours),
          supportPct: hours ? round((supportHours / hours) * 100, 1) : null,

          // ritmo
          daysWorked: dayVals.length,
          avgPerDay: dayVals.length ? round(hours / dayVals.length) : 0,
          maxDay: dayVals.length ? round(Math.max(...dayVals)) : 0,
          firstDay: dayKeys[0] ?? null,
          lastDay: dayKeys[dayKeys.length - 1] ?? null,
          idleDays: dayKeys.length
            ? Math.round((Date.parse(iso(new Date())) - Date.parse(dayKeys[dayKeys.length - 1])) / 86400000)
            : null,

          // concentración: qué parte de su tiempo va a su tarea principal
          topTaskKey,
          topTaskHours: round(topTaskHours),
          focusPct: hours ? round((topTaskHours / hours) * 100, 1) : null,

          pointsDone: round(sum(assigned.filter((t) => t.status === 'done').map(pts))),
        };
      })
      .sort((a, b) => b.hours - a.hours);

    // reparto de horas por persona x proyecto (para ver dispersión de foco)
    const userProject = new Map<string, number>();
    for (const d of deds) {
      const k = `${d.user_id}||${d.project_id}`;
      userProject.set(k, (userProject.get(k) ?? 0) + d.hours);
    }
    const heatmap = [...userProject].map(([k, hours]) => {
      const [user_id, project_id] = k.split('||');
      return { user_id, name: userName.get(user_id) ?? user_id, project_id, hours: round(hours) };
    });

    /* ------------------------------------------------------------- burndown */

    let burndown: any[] = [];
    let daily: { date: string; hours: number }[] = [];

    const dedByDate = new Map<string, number>();
    for (const d of deds) dedByDate.set(d.date, (dedByDate.get(d.date) ?? 0) + d.hours);

    if (sprint.start_date && sprint.end_date) {
      const days = dateRange(sprint.start_date, sprint.end_date);
      const workDays = days.filter((d) => !isWeekend(d));
      const today = iso(new Date());

      let cumHours = 0;
      burndown = days.map((date) => {
        // El burndown se mide en HORAS ESTIMADAS de las tareas cerradas: el equipo
        // no usa puntos de historia. Los puntos se mantienen por si algún día se
        // usan, pero no son la serie principal.
        const cerradas = tasks.filter((t) => {
          const c = cierre(t);
          return t.status === 'done' && c && c <= date;
        });
        const doneHours = sum(cerradas.map(est));
        const donePts = sum(cerradas.map(pts));
        cumHours += dedByDate.get(date) ?? 0;

        // línea ideal sobre días laborables
        const idx = workDays.indexOf(date);
        const pos = idx >= 0 ? idx : workDays.filter((d) => d < date).length;
        const factor = workDays.length > 1 ? 1 - pos / (workDays.length - 1) : 0;
        const idealHours = round(Math.max(estimateHours * factor, 0));
        const ideal = totalPoints ? round(Math.max(totalPoints * factor, 0)) : null;

        const past = date <= today;
        return {
          date,
          weekend: isWeekend(date),
          // serie principal, en horas
          idealHours,
          remainingEstimate: past ? round(estimateHours - doneHours) : null,
          completedEstimate: past ? round(doneHours) : null,
          tasksDone: past ? cerradas.length : null,
          // serie en puntos, sólo si el equipo los usa
          ideal,
          remainingPoints: past && totalPoints ? round(totalPoints - donePts) : null,
          completedPoints: past && totalPoints ? round(donePts) : null,
          // null en el futuro: si no, salen barras de 0 con tooltip como si
          // hubiera imputaciones en días que aún no han pasado
          loggedHours: past ? round(dedByDate.get(date) ?? 0) : null,
          cumulativeHours: past ? round(cumHours) : null,
          remainingHours: past ? round(Math.max(estimateHours - cumHours, 0)) : null,
        };
      });

      daily = days.map((date) => ({ date, hours: round(dedByDate.get(date) ?? 0) }));
    } else {
      daily = [...dedByDate.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, hours]) => ({ date, hours: round(hours) }));
    }

    /* --------------------------------------------------------------- salida */

    return {
      sprint,
      totals: {
        tasks: tasks.length,
        tasksDone: done.length,
        completionRate: tasks.length ? round((done.length / tasks.length) * 100, 1) : 0,
        committedPoints: round(committedPoints),
        addedPoints: round(addedPoints),
        totalPoints: round(totalPoints),
        completedPoints: round(completedPoints),
        velocityRate: totalPoints ? round((completedPoints / totalPoints) * 100, 1) : 0,
        estimateHours: round(estimateHours),
        loggedHours: round(loggedHours),
        hoursDelta: round(loggedHours - estimateHours),
        estimateAccuracy: estimateHours ? round((loggedHours / estimateHours) * 100, 1) : null,
        hoursPerPoint: completedPoints ? round(loggedHours / completedPoints) : null,
        scopeAddedTasks: added.length,
        scopeChangeRate: committedPoints ? round((addedPoints / committedPoints) * 100, 1) : 0,
        spilloverTasks: spillover.length,
        spilloverPoints: round(sum(spillover.map(pts))),
        blockedTasks: tasks.filter((t) => t.blocked).length,
        unestimatedTasks: tasks.filter((t) => t.estimate_points == null && t.estimate_hours == null).length,
        unassignedTasks: tasks.filter((t) => !t.assignee_id).length,
        tasksWithRemaining: withRemaining.length,
        remainingHours: withRemaining.length ? round(remainingHours) : null,
        // avance = 1 - restante/estimado, sobre las tareas que tienen dato de Jira
        progressPct:
          estimateOfTracked > 0
            ? round((1 - remainingHours / estimateOfTracked) * 100, 1)
            : null,
        readyToCloseCount: readyToClose.length,
        atRiskCount: atRisk.length,
        stalledCount: stalled.length,
        tasksWithJira: withJira.length,
        carriedOverCount: carried.length,
        impedimentCount: impediments.length,
        jiraLifetimeHours: jiraLifetimeHours ? round(jiraLifetimeHours) : null,
        peopleInvolved: userHours.size,
        teamCapacity: capacityIsSet ? round(teamCapacity) : null,
        plannedLoad: capacityIsSet && teamCapacity ? round((estimateHours / teamCapacity) * 100, 1) : null,
        teamUtilization: capacityIsSet && teamCapacity ? round((loggedHours / teamCapacity) * 100, 1) : null,
        discoveryRatio,
        deliveryCapacity: capacityIsSet ? round(deliveryCapacity) : null,
        discoveryCapacity: capacityIsSet ? round(discoveryCapacity) : null,
        // Cuánto se pasa el delivery de su parte: eso es lo que le roba al discovery.
        deliveryOverflow: round(deliveryOverflow),
        // Lo que realmente le queda al discovery una vez servido el delivery.
        discoveryLeftover: capacityIsSet ? round(Math.max(discoveryCapacity - deliveryOverflow, 0)) : null,
        // Reparto real de horas dedicadas, para contrastar con el objetivo.
        actualDiscoveryShare: discovery.shareOfLogged,
      },
      byTrack,
      byStatus,
      byType,
      byProject,
      byUser,
      heatmap,
      burndown,
      daily,
      estimateOutliers: outliers,
      deviation,
      doneByEstimate,
      velocity,
      forecast,
      readyToClose,
      atRisk: atRisk.slice(0, 12),
      stalled: stalled.slice(0, 12),
      burn: burn.slice(0, 20),
      statusDivergence,
      carried,
      impediments,
      oldest,
      byComponent: dimension((t) => t.component),
      byPriority: dimension((t) => t.priority),
      byEpic: dimension((t) => t.epic),
    };
}

export default async function metricsRoutes(app: FastifyInstance) {
  app.get('/api/sprints/:id/metrics', async (req, reply) => {
    const { id } = req.params as { id: string };
    const m = await computeMetrics(id);
    if (!m) {
      reply.code(404);
      return { error: 'sprint not found' };
    }
    return m;
  });

  /**
   * Detalle de una persona dentro de un sprint: en qué ha trabajado, cuánto de
   * cada tarea es suyo y cómo se reparte su tiempo.
   */
  app.get('/api/sprints/:id/users/:userId', async (req, reply) => {
    const { id, userId } = req.params as { id: string; userId: string };

    const user = await one<{ id: string; name: string; capacity: number | null }>(
      `select u.id, u.name, coalesce(sc.capacity_hours, u.capacity_hours) as capacity
       from users u
       left join sprint_capacities sc on sc.user_id = u.id and sc.sprint_id = $2
       where u.id = $1`,
      [userId, id]
    );
    if (!user) {
      reply.code(404);
      return { error: 'user not found' };
    }

    const sprint = await one<Sprint>(`select * from sprints where id = $1`, [id]);

    // Tareas en las que ha imputado, con cuánto es suyo y cuánto del total.
    const rows = await q<{
      key: string; title: string | null; project_id: string; status: string; blocked: boolean;
      track: string; type: string; estimate_hours: number | null; remaining_hours: number | null;
      assignee_id: string | null; my_hours: number; task_hours: number; people: number;
      first_date: string; last_date: string;
    }>(
      `select t.key, t.title, t.project_id, t.status, t.blocked, t.track, t.type,
              t.estimate_hours, t.remaining_hours, t.assignee_id,
              sum(d.hours) filter (where d.user_id = $2)              as my_hours,
              (select coalesce(sum(dd.hours), 0) from dedications dd where dd.task_uid = t.uid) as task_hours,
              (select count(distinct dd.user_id) from dedications dd where dd.task_uid = t.uid)::int as people,
              min(d.date) filter (where d.user_id = $2)               as first_date,
              max(d.date) filter (where d.user_id = $2)               as last_date
       from tasks t
       join dedications d on d.task_uid = t.uid
       where t.sprint_id = $1
       group by t.uid
       having sum(d.hours) filter (where d.user_id = $2) > 0
       order by sum(d.hours) filter (where d.user_id = $2) desc`,
      [id, userId]
    );

    const entries = await q<{ date: string; task_key: string; hours: number; note: string | null }>(
      `select d.date, t.key as task_key, d.hours, d.note
       from dedications d join tasks t on t.uid = d.task_uid
       where t.sprint_id = $1 and d.user_id = $2
       order by d.date, d.created_at`,
      [id, userId]
    );

    // Tareas de las que es responsable, aunque no haya imputado en ellas.
    const owned = await q<{ key: string; status: string }>(
      `select key, status from tasks where sprint_id = $1 and assignee_id = $2`,
      [id, userId]
    );

    const hours = sum(rows.map((r) => Number(r.my_hours)));
    const byDate = new Map<string, number>();
    for (const e of entries) byDate.set(e.date, (byDate.get(e.date) ?? 0) + Number(e.hours));

    const group = <K extends string>(key: (r: (typeof rows)[number]) => K) => {
      const m = new Map<K, { hours: number; tasks: number }>();
      for (const r of rows) {
        const k = key(r);
        const cur = m.get(k) ?? { hours: 0, tasks: 0 };
        m.set(k, { hours: cur.hours + Number(r.my_hours), tasks: cur.tasks + 1 });
      }
      return [...m].map(([k, v]) => ({ key: k, hours: round(v.hours), tasks: v.tasks }))
        .sort((a, b) => b.hours - a.hours);
    };

    const days = [...byDate.keys()].sort();
    const hoy = iso(new Date());
    const daily = sprint?.start_date && sprint?.end_date
      ? dateRange(sprint.start_date, sprint.end_date).map((date) => ({
          date,
          // los días que aún no han llegado no tienen dato, no tienen un 0
          hours: date <= hoy ? round(byDate.get(date) ?? 0) : null,
          weekend: isWeekend(date),
          future: date > hoy,
        }))
      : days.map((date) => ({
          date,
          hours: round(byDate.get(date)!),
          weekend: isWeekend(date),
          future: false,
        }));

    const worked = [...byDate.values()];

    return {
      user,
      totals: {
        hours: round(hours),
        capacity: user.capacity,
        utilization: user.capacity ? round((hours / user.capacity) * 100, 1) : null,
        distinctTasks: rows.length,
        daysWorked: worked.length,
        avgPerDay: worked.length ? round(hours / worked.length) : 0,
        maxDay: worked.length ? round(Math.max(...worked)) : 0,
        entries: entries.length,
        ownedTasks: owned.length,
        ownedDone: owned.filter((o) => o.status === 'done').length,
        // Horas en tareas de las que NO es responsable: apoyo a compañeros.
        hoursOnOthers: round(
          sum(rows.filter((r) => r.assignee_id && r.assignee_id !== userId).map((r) => Number(r.my_hours)))
        ),
      },
      daily,
      byProject: group((r) => r.project_id as any),
      byType: group((r) => r.type as any),
      byTrack: group((r) => r.track as any),
      tasks: rows.map((r) => ({
        key: r.key,
        title: r.title,
        project_id: r.project_id,
        status: r.status,
        blocked: r.blocked,
        track: r.track,
        type: r.type,
        estimate_hours: r.estimate_hours,
        remaining_hours: r.remaining_hours,
        isOwner: r.assignee_id === userId,
        myHours: round(Number(r.my_hours)),
        taskHours: round(Number(r.task_hours)),
        sharePct: Number(r.task_hours) ? round((Number(r.my_hours) / Number(r.task_hours)) * 100, 1) : 100,
        people: r.people,
        firstDate: r.first_date,
        lastDate: r.last_date,
      })),
      entries: entries.map((e) => ({ ...e, hours: round(Number(e.hours)) })),
    };
  });

  /* ------------------------------------------ tendencia entre sprints */

  app.get('/api/metrics/velocity', async () => {
    const rows = await q(
      `select s.id, s.name, s.start_date, s.end_date, s.status,
              count(t.uid)::int                                            as tasks,
              count(t.uid) filter (where t.status = 'done')::int            as tasks_done,
              coalesce(sum(t.estimate_points), 0)                           as total_points,
              coalesce(sum(t.estimate_points) filter (where t.status = 'done'), 0) as completed_points,
              coalesce(sum(t.estimate_hours), 0)                            as estimate_hours,
              coalesce((select sum(d.hours) from dedications d
                        join tasks tt on tt.uid = d.task_uid
                        where tt.sprint_id = s.id), 0)                      as logged_hours
       from sprints s
       left join tasks t on t.sprint_id = s.id
       group by s.id
       order by coalesce(s.start_date, '1900-01-01'), s.id`
    );
    return rows;
  });
}
