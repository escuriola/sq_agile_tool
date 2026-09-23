import type { FastifyInstance } from 'fastify';
import { computeMetrics } from './metrics.js';

/** Severidad de un hallazgo. `info` es contexto, no un problema. */
type Sev = 'high' | 'medium' | 'info';
type Finding = { sev: Sev; area: string; title: string; detail: string; evidence?: string[] };

const r1 = (n: number) => Math.round(n * 10) / 10;
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const iso = (d: Date) => d.toISOString().slice(0, 10);

const isWeekend = (d: string) => {
  const wd = new Date(d + 'T00:00:00Z').getUTCDay();
  return wd === 0 || wd === 6;
};

function workDaysBetween(a: string, b: string) {
  let n = 0;
  const cur = new Date(a + 'T00:00:00Z');
  const end = new Date(b + 'T00:00:00Z');
  while (cur <= end && n < 400) {
    if (!isWeekend(iso(cur))) n++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return n;
}

export default async function reportRoutes(app: FastifyInstance) {
  /**
   * Informe del sprint para el Scrum Master: no repite las métricas, las
   * interpreta. Cada hallazgo lleva su evidencia para poder contrastarlo.
   */
  app.get('/api/sprints/:id/report', async (req, reply) => {
    const { id } = req.params as { id: string };
    const m = await computeMetrics(id);
    if (!m) {
      reply.code(404);
      return { error: 'sprint not found' };
    }

    const t = m.totals;
    const dv = m.deviation;
    const hoy = iso(new Date());
    const s = m.sprint;

    /* ------------------------------------------------- avance del calendario */

    let elapsed: number | null = null;
    let totalDays: number | null = null;
    let timePct: number | null = null;
    let daysLeft: number | null = null;
    if (s.start_date && s.end_date) {
      totalDays = workDaysBetween(s.start_date, s.end_date);
      const hasta = hoy < s.end_date ? hoy : s.end_date;
      elapsed = hoy < s.start_date ? 0 : workDaysBetween(s.start_date, hasta);
      timePct = pct(elapsed, totalDays);
      daysLeft = Math.max(totalDays - elapsed, 0);
    }

    // Cuánto trabajo se ha entregado frente a cuánto sprint se ha consumido.
    const deliveredPct = pct(dv.estimateDone, t.estimateHours);
    const findings: Finding[] = [];
    const add = (f: Finding) => findings.push(f);

    /* --------------------------------------------------------------- ritmo */

    if (timePct != null && timePct > 15) {
      const gap = timePct - deliveredPct;
      if (gap >= 25) {
        add({
          sev: 'high',
          area: 'Pace',
          title: `${timePct}% of the sprint consumed, ${deliveredPct}% delivered`,
          detail:
            `${dv.estimateDone} h closed out of ${t.estimateHours} h committed, with ` +
            `${daysLeft} working days left. At this pace it will not all fit.`,
        });
      } else if (gap >= 10) {
        add({
          sev: 'medium',
          area: 'Pace',
          title: `The sprint is ${gap} points behind the calendar`,
          detail: `${timePct}% of time consumed against ${deliveredPct}% of work closed.`,
        });
      }
    }

    // Proyección de horas: si el equipo sigue al mismo ritmo diario.
    if (elapsed && elapsed > 0 && daysLeft != null && t.teamCapacity) {
      const porDia = t.loggedHours / elapsed;
      const proyectado = r1(t.loggedHours + porDia * daysLeft);
      const util = pct(proyectado, t.teamCapacity);
      if (util < 70) {
        add({
          sev: 'medium',
          area: 'Capacity',
          title: `Projected hours land at ${util}% of capacity`,
          detail:
            `${t.loggedHours} h logged over ${elapsed} days (${r1(porDia)} h/day). ` +
            `At that pace the sprint would close at ~${proyectado} h of the ${t.teamCapacity} h of ` +
            `capacity. Either people are not logging everything, or capacity is overstated.`,
        });
      }
    }

    /* ------------------------------------------------------------- personas */

    for (const u of m.byUser) {
      const ev: string[] = [];
      if (u.utilization != null) ev.push(`${u.hours} h of ${u.capacity} h (${u.utilization}%)`);
      if (u.tasksAssigned) ev.push(`${u.tasksDone}/${u.tasksAssigned} of their tasks closed`);

      if (u.utilization != null && u.utilization > 100) {
        add({
          sev: 'high',
          area: 'People',
          title: `${u.name} is over capacity (${u.utilization}%)`,
          detail: `Logged ${u.hours} h against ${u.capacity} h assigned for this sprint.`,
          evidence: ev,
        });
      } else if (u.utilization != null && timePct != null && timePct > 40 && u.utilization < timePct - 25) {
        add({
          sev: 'medium',
          area: 'People',
          title: `${u.name} is well below capacity (${u.utilization}%)`,
          detail:
            `With ${timePct}% of the sprint gone it should be around that figure. ` +
            `Either they are not logging, they are on another project, or their capacity is wrong.`,
          evidence: ev,
        });
      }

      if (u.idleDays != null && u.idleDays >= 3) {
        add({
          sev: u.idleDays >= 5 ? 'high' : 'medium',
          area: 'People',
          title: `${u.name} has not logged time for ${u.idleDays} days`,
          detail: `Last entry on ${u.lastDay}. Worth asking in the daily.`,
        });
      }

      if (u.distinctTasks >= 8 && (u.focusPct ?? 100) < 30) {
        add({
          sev: 'medium',
          area: 'People',
          title: `${u.name} is very scattered: ${u.distinctTasks} distinct tasks`,
          detail:
            `Only ${u.focusPct}% of their time goes to their main task` +
            (u.topTaskKey ? ` (${u.topTaskKey})` : '') +
            `. That much context switching costs productivity.`,
          evidence: [`${u.supportHours} h on other people's tasks (${u.supportPct}%)`],
        });
      }

      if ((u.supportPct ?? 0) >= 40 && u.hours >= 5) {
        add({
          sev: 'info',
          area: 'People',
          title: `${u.name} spends ${u.supportPct}% of their time on other people's tasks`,
          detail:
            `${u.supportHours} h of ${u.hours} h. Usually review or support: real work that ` +
            `does not show up as theirs in the ownership split.`,
        });
      }

      if (u.tasksAssigned >= 3 && u.tasksDone === 0) {
        add({
          sev: 'medium',
          area: 'Ownership',
          title: `${u.name} owns ${u.tasksAssigned} tasks and has closed none`,
          detail: `They add up to ${u.ownedEstimate} h estimated. Worth reviewing blockers or scope.`,
        });
      }

      if (u.tasksBlocked > 0) {
        add({
          sev: 'high',
          area: 'Ownership',
          title: `${u.name} has ${u.tasksBlocked} of their own task(s) blocked`,
          detail: 'An unresolved blocker is the first thing a Scrum Master should attack.',
        });
      }

      if (u.ownDoneTasks >= 2 && u.ownDeviationPct != null && Math.abs(u.ownDeviationPct) >= 40) {
        add({
          sev: 'info',
          area: 'Estimation',
          title:
            `${u.name}'s tasks deviate by ${u.ownDeviationPct > 0 ? '+' : ''}` +
            `${u.ownDeviationPct}% from the estimate`,
          detail:
            `${u.ownLoggedDone} h actual against ${u.ownEstimateDone} h estimated across ` +
            `${u.ownDoneTasks} closed tasks.`,
        });
      }
    }

    // Gente con capacidad asignada que no ha aparecido en el sprint.
    const conCapacidadSinHoras = (m.byUser ?? []).filter((u) => u.capacity && u.hours === 0);
    for (const u of conCapacidadSinHoras) {
      add({
        sev: 'medium',
        area: 'People',
        title: `${u.name} has ${u.capacity} h of capacity and 0 h logged`,
        detail: 'Either they did not take part, or their capacity should be 0 for this sprint.',
      });
    }

    /* ---------------------------------------------------------- estimación */

    if (dv.tasksCompared >= 3) {
      const bajo = dv.underrunTasks / dv.tasksCompared;
      if (bajo >= 0.7 && dv.underrunHours > dv.overrunHours * 2) {
        add({
          sev: 'high',
          area: 'Estimation',
          title: `Systematic overestimation: ${dv.underrunTasks} of ${dv.tasksCompared} tasks cost less`,
          detail:
            `${dv.loggedDone} h actual against ${dv.estimateDone} h estimated (${dv.deviationPct}%). ` +
            `This is not one-off slack: it is a bias that fits less work than could fit.`,
          evidence: dv.worstUnderrun.slice(0, 3).map(
            (d: any) => `${d.key}: ${d.logged_hours} h of ${d.estimate_hours} h (×${d.ratio})`
          ),
        });
      } else if (dv.overrunHours > dv.underrunHours * 2 && dv.overrunTasks >= 3) {
        add({
          sev: 'high',
          area: 'Estimation',
          title: `Underestimation: ${dv.overrunTasks} tasks went over, ${dv.overrunHours} h of overrun`,
          detail: 'The team commits to more than fits. Review refinement.',
          evidence: dv.worstOverrun.slice(0, 3).map(
            (d: any) => `${d.key}: ${d.logged_hours} h of ${d.estimate_hours} h (×${d.ratio})`
          ),
        });
      }
    }

    if (dv.openOverrunTasks > 0) {
      add({
        sev: 'medium',
        area: 'Estimation',
        title: `${dv.openOverrunTasks} open tasks already exceed their estimate`,
        detail: `They add up to ${dv.openOverrunHours} h of overrun and are still not closed.`,
        evidence: dv.openOverrun.slice(0, 4).map(
          (d: any) => `${d.key}: ${d.logged_hours} h of ${d.estimate_hours} h`
        ),
      });
    }

    if (t.unestimatedTasks > 0) {
      add({
        sev: 'medium',
        area: 'Data',
        title: `${t.unestimatedTasks} tasks without an estimate in hours`,
        detail: 'Without an estimate they count for neither the burndown nor the deviation.',
      });
    }

    /* ------------------------------------------------- alcance y flujo */

    if (t.deliveryOverflow > 0) {
      add({
        sev: 'medium',
        area: 'Scope',
        title: `Delivery is ${t.deliveryOverflow} h over its share`,
        detail:
          `Delivery capacity is ${t.deliveryCapacity} h and ${m.byTrack[0]?.estimateHours} h are ` +
          `committed. It takes from discovery, which drops to ${t.discoveryLeftover} h.`,
      });
    }

    if (t.actualDiscoveryShare != null && t.discoveryRatio > 0) {
      const objetivo = Math.round(t.discoveryRatio * 100);
      if (t.actualDiscoveryShare < objetivo / 2) {
        add({
          sev: 'medium',
          area: 'Scope',
          title: `Discovery is running out of time: ${t.actualDiscoveryShare}% against the ${objetivo}% target`,
          detail: 'If this repeats sprint after sprint, discovery disappears in practice.',
        });
      }
    }

    if (t.scopeAddedTasks > 0) {
      add({
        sev: t.scopeAddedTasks > 4 ? 'high' : 'medium',
        area: 'Scope',
        title: `${t.scopeAddedTasks} tasks were added after the sprint started`,
        detail: 'Scope change: worth knowing who adds them and why.',
      });
    }

    if (t.carriedOverCount > 0) {
      add({
        sev: 'medium',
        area: 'Scope',
        title: `${t.carriedOverCount} tasks are carried over from earlier sprints`,
        detail: 'A task crossing several sprints is usually badly sliced or blocked.',
        evidence: m.carried.map((c: any) => `${c.key}: sprint #${c.sprints}, ${c.logged_hours}/${c.estimate_hours} h`),
      });
    }

    if (t.impedimentCount > 0) {
      add({
        sev: 'high',
        area: 'Impediments',
        title: `${t.impedimentCount} tasks with an impediment`,
        detail: 'Flagged in Jira or with a declared blocker.',
        evidence: m.impediments.map(
          (i: any) => `${i.key}${i.blockedBy.length ? ` ← blocked by ${i.blockedBy.join(', ')}` : ' (flag)'}`
        ),
      });
    }

    if (t.stalledCount > 0) {
      add({
        sev: 'medium',
        area: 'Flow',
        title: `${t.stalledCount} stalled tasks`,
        detail: 'They have logged time but have not been touched for 3 or more days.',
        evidence: m.stalled.slice(0, 5).map((x: any) => `${x.key}: ${x.idleDays} days, ${x.logged_hours} h spent`),
      });
    }

    if (t.readyToCloseCount > 0) {
      add({
        sev: 'medium',
        area: 'Flow',
        title: `${t.readyToCloseCount} tasks Jira considers done are still open here`,
        detail: 'Closing them fixes the burndown and the completion percentage.',
        evidence: m.readyToClose.slice(0, 6).map((x: any) => `${x.key} (${x.status})`),
      });
    }

    if (t.unassignedTasks > 0) {
      add({
        sev: t.unassignedTasks > t.tasks / 2 ? 'medium' : 'info',
        area: 'Ownership',
        title: `${t.unassignedTasks} of ${t.tasks} tasks have no owner`,
        detail: 'With no owner there is nobody to ask about them in the daily.',
      });
    }

    /* ---------------------------------------------------- reparto del trabajo */

    const sinArrancar = m.byProject.filter((p: any) => p.loggedHours === 0 && p.estimateHours > 0);
    for (const p of sinArrancar) {
      add({
        sev: 'medium',
        area: 'Projects',
        title: `${p.project_id} has not started: 0 h against ${p.estimateHours} h committed`,
        detail: `${p.tasks} tasks without a single hour logged.`,
      });
    }

    const bugSupport = m.byType
      .filter((x: any) => x.type === 'bug' || x.type === 'support')
      .reduce((a: number, x: any) => a + x.pctHours, 0);
    if (bugSupport >= 30) {
      add({
        sev: 'medium',
        area: 'Quality',
        title: `${r1(bugSupport)}% of the effort goes to bugs and support`,
        detail: 'Above 30% usually means a quality problem or too many interruptions.',
      });
    }

    const orden: Record<Sev, number> = { high: 0, medium: 1, info: 2 };
    findings.sort((a, b) => orden[a.sev] - orden[b.sev] || a.area.localeCompare(b.area));

    // Aviso cuando el tamaño de tarea que no fluye es sistemático.
    const atascados = (m.doneByEstimate ?? []).filter(
      (r: any) => r.estimate > 0 && r.total >= 3 && r.pctDone < 40
    );
    for (const r of atascados) {
      add({
        sev: 'medium',
        area: 'Flow',
        title: `Tasks estimated at ${r.estimate} h barely move: ${r.done} of ${r.total} closed`,
        detail:
          `Only ${r.pctDone}% of that size is done while other sizes flow. ` +
          `Usually a sign they should be sliced before entering the sprint.`,
      });
    }

    return {
      generatedAt: new Date().toISOString(),
      velocity: m.velocity,
      forecast: m.forecast,
      doneByEstimate: m.doneByEstimate,
      sprint: s,
      progress: { elapsed, totalDays, daysLeft, timePct, deliveredPct },
      summary: {
        tasks: t.tasks,
        tasksDone: t.tasksDone,
        completionRate: t.completionRate,
        estimateHours: t.estimateHours,
        deliveredHours: dv.estimateDone,
        loggedHours: t.loggedHours,
        teamCapacity: t.teamCapacity,
        teamUtilization: t.teamUtilization,
        deltaDone: dv.deltaDone,
        deviationPct: dv.deviationPct,
        overrunHours: dv.overrunHours,
        underrunHours: dv.underrunHours,
        spilloverTasks: t.spilloverTasks,
        blockedTasks: t.blockedTasks,
      },
      counts: {
        high: findings.filter((f) => f.sev === 'high').length,
        medium: findings.filter((f) => f.sev === 'medium').length,
        info: findings.filter((f) => f.sev === 'info').length,
      },
      findings,
      byUser: m.byUser,
      byProject: m.byProject,
      byType: m.byType,
      byTrack: m.byTrack,
      deviation: dv,
    };
  });
}
