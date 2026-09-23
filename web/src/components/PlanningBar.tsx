import { useMemo } from 'react';
import { trackMeta, type Capacity, type Project, type Sprint, type Task, type TaskTrack } from '../lib/types';
import { Button, Card, cx } from './ui';

type ProjectRow = { project: Project; tasks: number; points: number; hours: number; unestimated: number };

const empty = () => ({ tasks: 0, points: 0, hours: 0, unestimated: 0 });

function groupByProject(tasks: Task[], projects: Project[]): ProjectRow[] {
  const map = new Map<string, ReturnType<typeof empty>>();
  for (const p of projects) map.set(p.id, empty());
  for (const t of tasks) {
    const r = map.get(t.project_id) ?? empty();
    r.tasks += 1;
    r.points += t.estimate_points ?? 0;
    r.hours += t.estimate_hours ?? 0;
    if (t.estimate_hours == null) r.unestimated += 1;
    map.set(t.project_id, r);
  }
  return projects.map((p) => ({ project: p, ...(map.get(p.id) ?? empty()) }));
}

/** Un carril (delivery o discovery) con su capacidad y su desglose por proyecto. */
function TrackPanel({
  track,
  capacity,
  rows,
  totalHours,
  totalTasks,
}: {
  track: TaskTrack;
  capacity: number;
  rows: ProjectRow[];
  totalHours: number;
  totalTasks: number;
}) {
  const meta = trackMeta(track);
  const load = capacity > 0 ? (totalHours / capacity) * 100 : null;
  const remaining = capacity - totalHours;
  const over = remaining < 0;
  const visible = rows.filter((r) => r.hours > 0 || r.tasks > 0);

  return (
    <div className="rounded-lg border border-[var(--color-ink-800)] bg-[var(--color-ink-850)]/40 p-3">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="size-2.5 rounded-full" style={{ backgroundColor: meta.color }} />
          <span className="text-sm font-semibold text-slate-200">{meta.label}</span>
          <span className="text-xs text-slate-500">
            {totalTasks} tasks · {totalHours.toFixed(1)} h of {capacity.toFixed(0)} h
          </span>
        </div>
        {load != null && (
          <span
            className={cx(
              'text-lg font-semibold',
              over ? 'text-rose-400' : load > 85 ? 'text-amber-400' : 'text-emerald-400'
            )}
          >
            {load.toFixed(0)}%
          </span>
        )}
      </div>

      {/* barra de ocupación del carril */}
      <div className="relative h-3 w-full overflow-hidden rounded-full bg-[var(--color-ink-800)]">
        <div className="flex h-full">
          {visible
            .filter((r) => r.hours > 0)
            .map((r) => (
              <div
                key={r.project.id}
                title={`${r.project.id}: ${r.hours.toFixed(1)} h`}
                style={{
                  width: `${capacity > 0 ? Math.min((r.hours / capacity) * 100, 100) : 0}%`,
                  backgroundColor: r.project.color ?? meta.color,
                }}
              />
            ))}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between text-sm">
        <span className="text-slate-500">{over ? 'Over by' : 'Headroom'}</span>
        <span className={cx('font-semibold', over ? 'text-rose-400' : 'text-slate-200')}>
          {over ? '+' : ''}
          {Math.abs(remaining).toFixed(1)} h
        </span>
      </div>

      {visible.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5 border-t border-[var(--color-ink-800)] pt-3">
          {visible.map((r) => (
            <div key={r.project.id} className="flex items-center gap-2 text-xs">
              <span className="w-16 shrink-0 font-mono" style={{ color: r.project.color ?? '#94a3b8' }}>
                {r.project.id}
              </span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-ink-800)]">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${capacity > 0 ? Math.min((r.hours / capacity) * 100, 100) : 0}%`,
                    backgroundColor: r.project.color ?? meta.color,
                  }}
                />
              </div>
              <span className="w-16 shrink-0 text-right text-slate-300">{r.hours.toFixed(1)} h</span>
              <span className="w-14 shrink-0 text-right text-slate-600">{r.tasks} t.</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Panel de sprint planning. La capacidad del sprint se parte en dos carriles:
 * delivery (el commitment) y discovery. El delivery se mide contra SU parte,
 * no contra la capacidad total; si se pasa, se come el tiempo de discovery.
 */
export function PlanningBar({
  tasks,
  projects,
  capacities,
  sprint,
  onEditCapacity,
}: {
  tasks: Task[];
  projects: Project[];
  capacities: Capacity[];
  sprint?: Sprint;
  onEditCapacity: () => void;
}) {
  const capacity = useMemo(
    () => capacities.reduce((a, c) => a + (Number(c.effective_hours) || 0), 0),
    [capacities]
  );

  const ratio = Number(sprint?.discovery_ratio ?? 0.20);
  const deliveryCapacity = capacity * (1 - ratio);
  const discoveryCapacity = capacity * ratio;

  const deliveryTasks = tasks.filter((t) => t.track !== 'discovery');
  const discoveryTasks = tasks.filter((t) => t.track === 'discovery');

  const deliveryRows = useMemo(() => groupByProject(deliveryTasks, projects), [tasks, projects]);
  const discoveryRows = useMemo(() => groupByProject(discoveryTasks, projects), [tasks, projects]);

  const hoursOf = (rows: ProjectRow[]) => rows.reduce((a, r) => a + r.hours, 0);
  const deliveryHours = hoursOf(deliveryRows);
  const discoveryHours = hoursOf(discoveryRows);
  const totalHours = deliveryHours + discoveryHours;
  const unestimated = tasks.filter((t) => t.estimate_hours == null).length;

  // Lo que el delivery se pasa de su parte se lo quita al discovery.
  const overflow = Math.max(deliveryHours - deliveryCapacity, 0);

  return (
    <Card
      title="Sprint planning"
      actions={
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">
            {tasks.length} tasks · <span className="text-slate-300">{totalHours.toFixed(1)} h</span> of{' '}
            {capacity.toFixed(0)} h
          </span>
          <Button size="sm" onClick={onEditCapacity}>
            Capacity & split
          </Button>
        </div>
      }
    >
      {capacity === 0 ? (
        <button onClick={onEditCapacity} className="text-sm text-amber-500 hover:text-amber-400">
          Set the team capacity for this sprint to see how much delivery fits →
        </button>
      ) : (
        <div className="flex flex-col gap-4">
          {/* reparto objetivo de la capacidad */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <div className="flex items-baseline gap-2">
              <span className="text-slate-500">Sprint capacity</span>
              <span className="text-lg font-semibold text-slate-100">{capacity.toFixed(0)} h</span>
              <span className="text-[11px] text-slate-600">
                ({capacities.filter((c) => Number(c.effective_hours) > 0).length} people)
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-slate-500">Target split</span>
              <span className="text-sky-400">{(100 - ratio * 100).toFixed(0)}% delivery</span>
              <span className="text-slate-700">/</span>
              <span className="text-purple-400">{(ratio * 100).toFixed(0)}% discovery</span>
            </div>
            {unestimated > 0 && (
              <span className="text-xs text-amber-500">{unestimated} task(s) without an estimate in hours</span>
            )}
          </div>

          {/* El delivery es el foco: ocupa todo el ancho y lleva el desglose por proyecto. */}
          <TrackPanel
            track="delivery"
            capacity={deliveryCapacity}
            rows={deliveryRows}
            totalHours={deliveryHours}
            totalTasks={deliveryTasks.length}
          />

          {overflow > 0 ? (
            <div className="rounded-md border border-rose-900/70 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
              You are <strong>{overflow.toFixed(1)} h</strong> over the delivery capacity
              ({deliveryCapacity.toFixed(0)} h). Take those hours out of the sprint or raise the split.
            </div>
          ) : (
            <div className="rounded-md border border-[var(--color-ink-700)] bg-[var(--color-ink-900)]/60 px-3 py-2 text-sm text-slate-400">
              You have room for{' '}
              <strong className="text-emerald-400">{(deliveryCapacity - deliveryHours).toFixed(1)} h</strong>{' '}
              more of delivery.
            </div>
          )}

          {/* Discovery: sólo se despliega cuando de verdad hay algo en ese carril. */}
          {discoveryTasks.length > 0 ? (
            <TrackPanel
              track="discovery"
              capacity={discoveryCapacity}
              rows={discoveryRows}
              totalHours={discoveryHours}
              totalTasks={discoveryTasks.length}
            />
          ) : (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-dashed border-[var(--color-ink-700)] px-3 py-2 text-xs text-slate-600">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-purple-400/50" />
                <span className="text-slate-500">Discovery</span>
              </span>
              <span>
                {discoveryCapacity.toFixed(0)} h reserved
                {overflow > 0 && `, of which delivery takes ${overflow.toFixed(1)} h`}
              </span>
              <span className="text-slate-700">·</span>
              <span>no tasks yet; mark a task as Discovery to start splitting it</span>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
