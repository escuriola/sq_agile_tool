import { useMemo } from 'react';
import type { Capacity, Project, Sprint, Task } from '../lib/types';
import { Card, cx } from './ui';

const r1 = (n: number) => Math.round(n * 10) / 10;

type Row = {
  id: string | null;
  name: string;
  tasks: number;
  estimate: number;
  /** La parte de la estimación que es desarrollo del owner: el resto lo revisa otro. */
  dev: number;
  done: number;
  doneEstimate: number;
  blocked: number;
  unestimated: number;
  capacity: number;
  byProject: Record<string, number>;
};

/**
 * Reparto del compromiso por persona: cuánta estimación lleva cada una frente a
 * su capacidad de delivery. Se calcula en el cliente a partir de las tareas ya
 * cargadas, así que se actualiza en cuanto cambias un responsable en la lista.
 */
export function WorkloadByOwner({
  tasks,
  capacities,
  projects,
  sprint,
  selectedOwner,
  onSelectOwner,
}: {
  tasks: Task[];
  capacities: Capacity[];
  projects: Project[];
  sprint?: Sprint;
  selectedOwner: string;
  onSelectOwner: (id: string) => void;
}) {
  const discovery = Number(sprint?.discovery_ratio ?? 0.2);
  /**
   * Al owner sólo se le carga la parte de desarrollo. La estimación de una tarea
   * cubre desarrollo Y revisión, y la revisión la hace otra persona; cargarle el
   * total infla su carga y deja el trabajo del revisor sin aparecer por ningún
   * lado. Lo que queda va a una bolsa de equipo, al pie de la tabla.
   */
  const reviewRatio = Number(sprint?.review_ratio ?? 0.3);
  const projectColor = new Map(projects.map((p) => [p.id, p.color ?? '#38bdf8']));

  const { rows, unassigned, totals } = useMemo(() => {
    const base = new Map<string | null, Row>();
    const nuevo = (id: string | null, name: string, capacity: number): Row => ({
      id, name, tasks: 0, estimate: 0, dev: 0, done: 0, doneEstimate: 0,
      blocked: 0, unestimated: 0, capacity, byProject: {},
    });

    // Todo el equipo con capacidad en el sprint aparece, aunque no lleve nada:
    // en el planning interesa tanto quién va cargado como quién está libre.
    for (const c of capacities) {
      const cap = Number(c.effective_hours) || 0;
      if (cap > 0 || tasks.some((t) => t.assignee_id === c.user_id)) {
        base.set(c.user_id, nuevo(c.user_id, c.name, cap * (1 - discovery)));
      }
    }

    const sinDuenno = nuevo(null, 'Unassigned', 0);

    for (const t of tasks) {
      // Los deployments consumen capacidad del sprint, no la de su owner.
      if (t.overhead) continue;
      const row = t.assignee_id ? base.get(t.assignee_id) ?? nuevo(t.assignee_id, t.assignee_id, 0) : sinDuenno;
      if (t.assignee_id && !base.has(t.assignee_id)) base.set(t.assignee_id, row);
      const e = t.estimate_hours ?? 0;
      row.tasks += 1;
      row.estimate += e;
      row.dev += e * (1 - reviewRatio);
      if (t.estimate_hours == null) row.unestimated += 1;
      if (t.blocked) row.blocked += 1;
      if (t.status === 'done') {
        row.done += 1;
        row.doneEstimate += e;
      }
      row.byProject[t.project_id] = (row.byProject[t.project_id] ?? 0) + e;
    }

    const list = [...base.values()].sort((a, b) => {
      const la = a.capacity ? a.dev / a.capacity : a.dev ? Infinity : -1;
      const lb = b.capacity ? b.dev / b.capacity : b.dev ? Infinity : -1;
      return lb - la;
    });

    return {
      rows: list,
      unassigned: sinDuenno,
      totals: {
        capacity: list.reduce((a, r) => a + r.capacity, 0),
        estimate: list.reduce((a, r) => a + r.estimate, 0) + sinDuenno.estimate,
        dev: list.reduce((a, r) => a + r.dev, 0) + sinDuenno.dev,
        tasks: list.reduce((a, r) => a + r.tasks, 0) + sinDuenno.tasks,
      },
    };
  }, [tasks, capacities, discovery, reviewRatio]);

  if (!rows.length && !unassigned.tasks) return null;

  const maxRef = Math.max(...rows.map((r) => Math.max(r.capacity, r.dev)), 1);

  const Barra = ({ row }: { row: Row }) => {
    const load = row.capacity ? (row.dev / row.capacity) * 100 : null;
    const over = load != null && load > 100;
    return (
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-[var(--color-ink-800)]">
        {/* referencia de capacidad, para comparar personas entre sí */}
        {row.capacity > 0 && (
          <div
            className="absolute top-0 h-full w-px bg-slate-500/70"
            style={{ left: `${(row.capacity / maxRef) * 100}%` }}
            title={`Delivery capacity ${r1(row.capacity)} h`}
          />
        )}
        <div className="flex h-full">
          {Object.entries(row.byProject)
            .filter(([, h]) => h > 0)
            .sort((a, b) => b[1] - a[1])
            .map(([pid, h]) => (
              <div
                key={pid}
                title={`${pid}: ${r1(h)} h`}
                style={{
                  width: `${Math.min((h / maxRef) * 100, 100)}%`,
                  backgroundColor: over ? '#f43f5e' : projectColor.get(pid) ?? '#38bdf8',
                }}
              />
            ))}
        </div>
      </div>
    );
  };

  return (
    <Card
      title="Workload per person"
      actions={
        <span className="text-xs text-slate-500">
          {totals.tasks} tasks · <span className="text-slate-300">{r1(totals.dev)} h</span> of
          development assigned of {r1(totals.capacity)} h delivery capacity
        </span>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="pb-1">Person</th>
              <th className="pb-1 text-right">Tasks</th>
              <th className="pb-1 text-right" title="The owner's share of the estimate">
                Development
              </th>
              <th className="pb-1 w-1/3 pl-3">Against delivery capacity</th>
              <th className="pb-1 text-right">Load</th>
              <th className="pb-1 text-right">Headroom</th>
              <th className="pb-1 text-right">Closed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-ink-800)]">
            {rows.map((row) => {
              const load = row.capacity ? (row.dev / row.capacity) * 100 : null;
              const over = load != null && load > 100;
              const sel = selectedOwner === row.id;
              return (
                <tr
                  key={row.id ?? '—'}
                  onClick={() => onSelectOwner(sel ? '' : (row.id ?? ''))}
                  className={cx(
                    'cursor-pointer hover:bg-[var(--color-ink-850)]/60',
                    sel && 'bg-[var(--color-ink-850)]'
                  )}
                  title="Click to filter the task list by this person"
                >
                  <td className="py-1.5 text-slate-200">
                    {row.name}
                    {row.blocked > 0 && (
                      <span className="ml-1 text-rose-400" title={`${row.blocked} blocked`}>
                        ⛔{row.blocked}
                      </span>
                    )}
                    {row.unestimated > 0 && (
                      <span
                        className="ml-1 text-amber-500"
                        title={`${row.unestimated} without an estimate`}
                      >
                        ?{row.unestimated}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 text-right text-slate-400">{row.tasks || '—'}</td>
                  <td
                    className="py-1.5 text-right text-slate-200"
                    title={`${r1(row.estimate)} h estimated in total; the other ${r1(row.estimate - row.dev)} h are review by someone else`}
                  >
                    {r1(row.dev) || '—'}
                    {row.estimate > 0 && (
                      <span className="ml-1 text-[10px] text-slate-600">of {r1(row.estimate)}</span>
                    )}
                  </td>
                  <td className="py-1.5 px-3">
                    <Barra row={row} />
                  </td>
                  <td
                    className={cx(
                      'py-1.5 text-right font-medium',
                      load == null
                        ? 'text-slate-700'
                        : over
                          ? 'text-rose-400'
                          : load > 85
                            ? 'text-amber-400'
                            : load < 50
                              ? 'text-sky-400'
                              : 'text-emerald-400'
                    )}
                  >
                    {load == null ? '—' : `${Math.round(load)}%`}
                  </td>
                  <td
                    className={cx('py-1.5 text-right', over ? 'text-rose-400' : 'text-slate-500')}
                  >
                    {row.capacity
                      ? `${over ? '+' : ''}${r1(Math.abs(row.capacity - row.dev))} h`
                      : '—'}
                  </td>
                  <td className="py-1.5 text-right text-slate-500">
                    {row.tasks ? `${row.done}/${row.tasks}` : '—'}
                  </td>
                </tr>
              );
            })}

            {unassigned.tasks > 0 && (
              <tr
                onClick={() => onSelectOwner(selectedOwner === '__none__' ? '' : '__none__')}
                className={cx(
                  'cursor-pointer border-t-2 border-[var(--color-ink-700)] hover:bg-[var(--color-ink-850)]/60',
                  selectedOwner === '__none__' && 'bg-[var(--color-ink-850)]'
                )}
                title="Click to filter the task list to unassigned tasks"
              >
                <td className="py-1.5 font-medium text-amber-400">Unassigned</td>
                <td className="py-1.5 text-right text-amber-400">{unassigned.tasks}</td>
                <td className="py-1.5 text-right text-amber-400">{r1(unassigned.estimate)}</td>
                <td className="py-1.5 px-3">
                  <Barra row={unassigned} />
                </td>
                <td className="py-1.5 text-right text-slate-700">—</td>
                <td className="py-1.5 text-right text-slate-700">—</td>
                <td className="py-1.5 text-right text-slate-500">
                  {unassigned.done}/{unassigned.tasks}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-xs text-slate-600">
        Each person is charged only the <strong>development</strong> share of what they own —{' '}
        {Math.round((1 - reviewRatio) * 100)}% of the estimate — against their delivery capacity,
        which is their sprint capacity minus the {Math.round(discovery * 100)}% reserved for
        discovery. The remaining{' '}
        <span className="text-purple-300">{r1(totals.estimate - totals.dev)} h</span> is the review
        those tasks will pull in, done by someone other than the owner: it is a team pool, not
        anyone's personal load. Deployment tasks are left out entirely — they eat sprint capacity,
        not their owner's. The thin vertical line on each bar marks that capacity, so bars can be
        compared across people. Click a row to filter the list below.
      </p>
    </Card>
  );
}
