import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  ComposedChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../lib/api';
import { statusMeta, trackMeta, typeMeta, type Project } from '../lib/types';
import { Badge, Button, Card, Empty, Stat, cx } from './ui';
import { useEffect, useState } from 'react';
import { UserDetail } from './UserDetail';

const AXIS = { stroke: '#475569', fontSize: 11 };
const GRID = '#1a2130';

const tooltipStyle = {
  contentStyle: {
    background: '#131923',
    border: '1px solid #273041',
    borderRadius: 8,
    fontSize: 12,
    color: '#e2e8f0',
  },
  labelStyle: { color: '#94a3b8' },
} as const;

const shortDate = (d: string) => d.slice(5).replace('-', '/');
const round1 = (n: number) => Math.round(n * 10) / 10;

export function SprintMetrics({
  sprintId,
  projects,
  onEditCapacity,
}: {
  sprintId: string;
  projects: Project[];
  onEditCapacity: () => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['metrics', sprintId],
    queryFn: () => api.sprints.metrics(sprintId),
  });

  const [openUser, setOpenUser] = useState<string | null>(null);
  const [factorDraft, setFactorDraft] = useState<string>('');
  const qc = useQueryClient();

  const saveFactor = useMutation({
    mutationFn: (v: number) => api.sprints.update(sprintId, { commit_factor: v } as any),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['metrics', sprintId] });
      qc.invalidateQueries({ queryKey: ['sprint', sprintId] });
      qc.invalidateQueries({ queryKey: ['report', sprintId] });
    },
  });
  // El campo arranca con el factor guardado del sprint y sólo cambia al tocarlo.
  useEffect(() => {
    if (data?.forecast) setFactorDraft(String(data.forecast.commitFactor));
  }, [data?.forecast?.commitFactor]);

  const projectColor = new Map(projects.map((p) => [p.id, p.color ?? '#38bdf8']));

  if (isLoading) return <p className="text-sm text-slate-500">Calculating metrics…</p>;
  if (error) return <Empty>{(error as Error).message}</Empty>;
  if (!data) return null;

  const t = data.totals;
  // El burndown sólo pinta días laborables: en fin de semana no se imputa y la
  // línea se quedaba plana dos días seguidos, ensuciando la comparación con el
  // ideal, que ya se calcula sólo sobre laborables.
  const burndownDays = data.burndown.filter((b) => !b.weekend);
  const hasBurndown = burndownDays.length > 0;
  const noData = t.tasks === 0;

  if (noData) return <Empty>Add tasks to the sprint to see metrics.</Empty>;

  // Mientras no haya nada en discovery, ese carril se muestra reducido a una línea.
  const discoveryTrack = data.byTrack.find((r) => r.track === 'discovery');
  const discoveryUsed = !!discoveryTrack && (discoveryTrack.tasks > 0 || discoveryTrack.loggedHours > 0);

  const accuracyTone =
    t.estimateAccuracy == null
      ? 'default'
      : t.estimateAccuracy > 120
        ? 'bad'
        : t.estimateAccuracy < 80
          ? 'warn'
          : 'good';

  return (
    <div className="flex flex-col gap-5">
      {/* ------------------------------------------------------------ titulares */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6">
        <Stat
          label="Completed"
          value={`${t.completionRate}%`}
          sub={`${t.tasksDone} of ${t.tasks} tasks`}
          tone={t.completionRate >= 80 ? 'good' : t.completionRate >= 50 ? 'warn' : 'bad'}
        />
        <Stat
          label="Delivered"
          value={`${data.deviation.estimateDone} h`}
          sub={`of ${t.estimateHours} h estimated (${t.estimateHours ? Math.round((data.deviation.estimateDone / t.estimateHours) * 100) : 0}%)`}
          tone={
            t.estimateHours && data.deviation.estimateDone / t.estimateHours >= 0.8 ? 'good' : 'warn'
          }
        />
        <Stat
          label="Hours logged"
          value={t.loggedHours}
          sub={`estimated ${t.estimateHours} h (${t.hoursDelta >= 0 ? '+' : ''}${t.hoursDelta})`}
        />
        <Stat
          label="Estimate accuracy"
          value={t.estimateAccuracy == null ? '—' : `${t.estimateAccuracy}%`}
          sub="actual / estimated"
          tone={accuracyTone as any}
        />
        <Stat
          label="Scope change"
          value={t.scopeAddedTasks}
          sub="tasks added after the sprint started"
          tone={t.scopeAddedTasks > 4 ? 'bad' : t.scopeAddedTasks ? 'warn' : 'good'}
        />
        <Stat
          label="Spillover"
          value={t.spilloverTasks}
          sub={`${round1(t.estimateHours - data.deviation.estimateDone)} h carried over`}
          tone={t.spilloverTasks === 0 ? 'good' : 'warn'}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6">
        <Stat
          label="Time deviation"
          value={`${data.deviation.deltaDone >= 0 ? '+' : ''}${data.deviation.deltaDone} h`}
          sub={
            data.deviation.deviationPct == null
              ? 'no closed tasks'
              : `${data.deviation.deviationPct > 0 ? '+' : ''}${data.deviation.deviationPct}% against the estimate`
          }
          tone={
            data.deviation.deviationPct == null
              ? 'default'
              : Math.abs(data.deviation.deviationPct) <= 15
                ? 'good'
                : data.deviation.deviationPct > 0
                  ? 'bad'
                  : 'warn'
          }
        />
        <Stat
          label="Sprint capacity"
          value={t.teamCapacity ?? '—'}
          sub={
            t.deliveryCapacity != null
              ? `${t.deliveryCapacity} h delivery / ${t.discoveryCapacity} h discovery`
              : 'not set'
          }
        />
        <Stat
          label="Actual utilisation"
          value={t.teamUtilization == null ? '—' : `${t.teamUtilization}%`}
          sub="actual hours / capacity"
          tone={
            t.teamUtilization == null
              ? 'default'
              : t.teamUtilization > 100
                ? 'bad'
                : t.teamUtilization < 60
                  ? 'warn'
                  : 'good'
          }
        />
        <Stat label="Blocked" value={t.blockedTasks} tone={t.blockedTasks ? 'bad' : 'default'} />
        <Stat label="Unestimated" value={t.unestimatedTasks} tone={t.unestimatedTasks ? 'warn' : 'good'} />
        <Stat
          label="Unassigned"
          value={t.unassignedTasks}
          sub={`of ${t.tasks} tasks`}
          tone={t.unassignedTasks ? 'warn' : 'good'}
        />
        <Stat label="People involved" value={t.peopleInvolved} />
      </div>

      {/* --------------------------- lo que aporta el export de incidencias */}
      {t.tasksWithJira > 0 && (
        <Card
          title="According to Jira"
          actions={
            <span className="text-xs text-slate-500">
              {t.tasksWithJira} tasks synced
            </span>
          }
        >
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="Carried over"
              value={t.carriedOverCount}
              sub="came from earlier sprints"
              tone={t.carriedOverCount ? 'warn' : 'good'}
            />
            <Stat
              label="Impediments"
              value={t.impedimentCount}
              sub="flag or declared blocker"
              tone={t.impedimentCount ? 'bad' : 'good'}
            />
            <Stat
              label="Total hours in Jira"
              value={t.jiraLifetimeHours ?? '—'}
              sub="lifetime, all roles"
            />
            <Stat
              label="Development here"
              value={t.loggedHours}
              sub="this sprint, developers only"
            />
          </div>

          {data.impediments.length > 0 && (
            <div className="mt-4">
              <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Impediments
              </h4>
              <table className="w-full text-xs">
                <tbody className="divide-y divide-[var(--color-ink-800)]">
                  {data.impediments.map((r) => (
                    <tr key={r.key}>
                      <td className="py-1 font-mono text-slate-300">{r.key}</td>
                      <td className="py-1 max-w-72 truncate text-slate-600">{r.title}</td>
                      <td className="py-1 text-right">
                        {r.flagged && <Badge color="#f43f5e">flag</Badge>}
                      </td>
                      <td className="py-1 text-right font-mono text-[11px] text-amber-400">
                        {r.blockedBy.length ? `blocked by ${r.blockedBy.join(', ')}` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data.carried.length > 0 && (
            <div className="mt-4">
              <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Carried over from earlier sprints
              </h4>
              <table className="w-full text-xs">
                <tbody className="divide-y divide-[var(--color-ink-800)]">
                  {data.carried.map((r) => (
                    <tr key={r.key}>
                      <td className="py-1 font-mono text-slate-300">{r.key}</td>
                      <td className="py-1 max-w-72 truncate text-slate-600">{r.title}</td>
                      <td className="py-1 text-right text-amber-400">sprint #{r.sprints}</td>
                      <td className="py-1 text-right text-slate-500">
                        {r.logged_hours} / {r.estimate_hours} h
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[
              { title: 'By component', rows: data.byComponent.slice(0, 8) },
              { title: 'By priority', rows: data.byPriority },
            ].map((b) => (
              <div key={b.title}>
                <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  {b.title}
                </h4>
                <table className="w-full text-xs">
                  <tbody className="divide-y divide-[var(--color-ink-800)]">
                    {b.rows.map((r) => (
                      <tr key={r.key}>
                        <td className="py-1 text-slate-300">{r.key}</td>
                        <td className="py-1 text-right text-slate-500">{r.tasks} t.</td>
                        <td className="py-1 text-right text-slate-500">{r.estimate} h est.</td>
                        <td className="py-1 text-right text-slate-200">{r.hours} h</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>

          {data.oldest.length > 0 && (
            <details className="mt-4 text-xs">
              <summary className="cursor-pointer text-slate-500 hover:text-slate-300">
                Oldest open tasks
              </summary>
              <table className="mt-1 w-full">
                <tbody className="divide-y divide-[var(--color-ink-800)]">
                  {data.oldest.map((r) => (
                    <tr key={r.key}>
                      <td className="py-1 font-mono text-slate-300">{r.key}</td>
                      <td className="py-1 max-w-72 truncate text-slate-600">{r.title}</td>
                      <td className="py-1 text-right text-slate-500">created {r.created}</td>
                      <td
                        className={cx('py-1 text-right', r.ageDays > 180 ? 'text-rose-400' : 'text-amber-400')}
                      >
                        {r.ageDays} days
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}

          <details className="mt-3 text-xs">
            <summary className="cursor-pointer text-slate-500 hover:text-slate-300">
              Status here vs status in Jira ({data.statusDivergence.length} tasks)
            </summary>
            <table className="mt-1 w-full">
              <tbody className="divide-y divide-[var(--color-ink-800)]">
                {data.statusDivergence.map((r) => (
                  <tr key={r.key}>
                    <td className="py-1 font-mono text-slate-300">{r.key}</td>
                    <td className="py-1">
                      <Badge color={statusMeta(r.appStatus).color}>{statusMeta(r.appStatus).label}</Badge>
                    </td>
                    <td className="py-1 text-slate-700">→</td>
                    <td className="py-1 text-slate-300">{r.jiraStatus}</td>
                    <td className="py-1 text-right text-slate-600">
                      {r.resolved ? `resolved ${r.resolved}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </Card>
      )}

      {/* ------------------------------ avance real, sin depender de estados */}
      {t.tasksWithRemaining > 0 && (
        <Card
          title="Real progress according to Jira"
          actions={
            <span className="text-xs text-slate-500">
              {t.tasksWithRemaining} of {t.tasks} tasks with imported data
            </span>
          }
        >
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="Progress"
              value={t.progressPct == null ? '—' : `${t.progressPct}%`}
              sub="1 − remaining / estimated"
              tone={t.progressPct != null && t.progressPct >= 50 ? 'good' : 'warn'}
            />
            <Stat label="Work remaining" value={`${t.remainingHours ?? '—'} h`} sub="as reported by Jira" />
            <Stat
              label="Ready to close"
              value={t.readyToCloseCount}
              sub="0 remaining, still open here"
              tone={t.readyToCloseCount ? 'warn' : 'good'}
            />
            <Stat
              label="Stalled"
              value={t.stalledCount}
              sub="3+ days untouched"
              tone={t.stalledCount ? 'warn' : 'good'}
            />
          </div>

          {data.readyToClose.length > 0 && (
            <div className="mt-4">
              <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Jira considers these done, still open here
              </h4>
              <table className="w-full text-xs">
                <tbody className="divide-y divide-[var(--color-ink-800)]">
                  {data.readyToClose.map((r) => (
                    <tr key={r.key}>
                      <td className="py-1 font-mono text-slate-300">{r.key}</td>
                      <td className="py-1 max-w-64 truncate text-slate-600">{r.title}</td>
                      <td className="py-1 text-slate-500">{statusMeta(r.status).label}</td>
                      <td className="py-1 text-right text-slate-400">
                        {r.logged_hours} / {r.estimate_hours} h
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data.stalled.length > 0 && (
            <div className="mt-4">
              <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                No movement
              </h4>
              <table className="w-full text-xs">
                <tbody className="divide-y divide-[var(--color-ink-800)]">
                  {data.stalled.map((r) => (
                    <tr key={r.key}>
                      <td className="py-1 font-mono text-slate-300">{r.key}</td>
                      <td className="py-1 max-w-64 truncate text-slate-600">{r.title}</td>
                      <td className="py-1 text-right text-amber-400">{r.idleDays} days</td>
                      <td className="py-1 text-right text-slate-500">{r.logged_hours} h spent</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data.atRisk.length > 0 && (
            <div className="mt-4">
              <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                At risk · over 80% consumed with work still left
              </h4>
              <table className="w-full text-xs">
                <tbody className="divide-y divide-[var(--color-ink-800)]">
                  {data.atRisk.map((r) => (
                    <tr key={r.key}>
                      <td className="py-1 font-mono text-slate-300">{r.key}</td>
                      <td className="py-1 text-right text-rose-400">{r.consumed}%</td>
                      <td className="py-1 text-right text-slate-500">
                        {r.logged_hours} / {r.estimate_hours} h · {r.remaining_hours ?? '?'} h left
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* --------------------------------------------- delivery vs discovery */}
      <Card
        title="Delivery vs discovery"
        actions={
          <span className="text-xs text-slate-500">
            target {(100 - t.discoveryRatio * 100).toFixed(0)}% / {(t.discoveryRatio * 100).toFixed(0)}%
          </span>
        }
      >
        <div
          className={cx(
            'grid grid-cols-1 gap-3',
            discoveryUsed && 'sm:grid-cols-2'
          )}
        >
          {data.byTrack
            .filter((r) => discoveryUsed || r.track === 'delivery')
            .map((r) => {
            const meta = trackMeta(r.track);
            const over = r.remainingHours != null && r.remainingHours < 0;
            return (
              <div
                key={r.track}
                className="rounded-lg border border-[var(--color-ink-800)] bg-[var(--color-ink-850)]/40 p-3"
              >
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                    <span className="size-2.5 rounded-full" style={{ backgroundColor: meta.color }} />
                    {meta.label}
                  </span>
                  {r.plannedLoad != null && (
                    <span
                      className={cx(
                        'text-lg font-semibold',
                        over ? 'text-rose-400' : r.plannedLoad > 85 ? 'text-amber-400' : 'text-emerald-400'
                      )}
                    >
                      {r.plannedLoad}%
                    </span>
                  )}
                </div>
                <dl className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Track capacity</dt>
                    <dd className="text-slate-300">{r.capacity ?? '—'} h</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Estimated</dt>
                    <dd className="text-slate-300">
                      {r.estimateHours} h · {r.tasks} tasks
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Actually logged</dt>
                    <dd className="text-slate-200">
                      {r.loggedHours} h
                      {r.shareOfLogged != null && (
                        <span className="ml-1 text-slate-600">({r.shareOfLogged}% of total)</span>
                      )}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">{over ? 'Over by' : 'Headroom'}</dt>
                    <dd className={cx(over ? 'text-rose-400' : 'text-slate-300')}>
                      {r.remainingHours == null ? '—' : `${Math.abs(r.remainingHours)} h`}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Completed</dt>
                    <dd className="text-slate-300">
                      {r.tasksDone}/{r.tasks} tasks
                    </dd>
                  </div>
                </dl>
              </div>
              );
            })}
        </div>

        {!discoveryUsed && (
          <p className="mt-3 rounded-lg border border-dashed border-[var(--color-ink-700)] px-3 py-2 text-xs text-slate-600">
            Discovery: {t.discoveryCapacity ?? '—'} h reserved, no tasks or hours yet. As soon as you mark
            tasks as Discovery their tracking and the actual split against the target will show up
            here.
          </p>
        )}

        {discoveryUsed && t.actualDiscoveryShare != null && (
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-xs text-slate-500">
              <span>Actual split of logged hours</span>
              <span>
                <span className="text-sky-400">{(100 - t.actualDiscoveryShare).toFixed(1)}% delivery</span>
                {' / '}
                <span className="text-purple-400">{t.actualDiscoveryShare}% discovery</span>
              </span>
            </div>
            <div className="relative flex h-3 overflow-hidden rounded-full bg-[var(--color-ink-800)]">
              <div style={{ width: `${100 - t.actualDiscoveryShare}%`, backgroundColor: '#38bdf8' }} />
              <div style={{ width: `${t.actualDiscoveryShare}%`, backgroundColor: '#c084fc' }} />
              {/* marca del objetivo */}
              <div
                className="absolute top-0 h-full w-0.5 bg-white/70"
                style={{ left: `${100 - t.discoveryRatio * 100}%` }}
                title={`Target: ${(100 - t.discoveryRatio * 100).toFixed(0)}% delivery`}
              />
            </div>
            <p className="mt-1.5 text-xs text-slate-600">
              The white marker is the target. If the purple band falls short of it, discovery ran out of time.
            </p>
          </div>
        )}

        {t.deliveryOverflow > 0 && (
          <div className="mt-3 rounded-md border border-rose-900/70 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
            Delivery committed {t.deliveryOverflow} h beyond its capacity
            {discoveryUsed && `, leaving discovery with ${t.discoveryLeftover} h of the ${t.discoveryCapacity} h target`}
            .
          </div>
        )}
      </Card>

      {t.teamCapacity == null && (
        <button
          onClick={onEditCapacity}
          className="self-start text-xs text-amber-500 hover:text-amber-400"
        >
          Define la capacidad del equipo para este sprint y verás utilización y ocupación reales →
        </button>
      )}

      {/* ------------------------------------------------------------ burndown */}
      {hasBurndown ? (
        <Card title="Burndown of estimated hours and daily effort">
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={burndownDays} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="date" tickFormatter={shortDate} {...AXIS} />
              <YAxis yAxisId="pts" {...AXIS} />
              <YAxis yAxisId="h" orientation="right" {...AXIS} />
              <Tooltip {...tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="h" dataKey="loggedHours" name="Hours that day" fill="#273041" radius={[3, 3, 0, 0]} />
              <Line
                yAxisId="pts"
                type="monotone"
                dataKey="idealHours"
                name="Ideal (h)"
                stroke="#475569"
                strokeDasharray="4 4"
                dot={false}
              />
              <Line
                yAxisId="pts"
                type="monotone"
                dataKey="remainingEstimate"
                name="Remaining (estimated h)"
                stroke="#38bdf8"
                strokeWidth={2}
                dot={{ r: 2 }}
                connectNulls={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
          <p className="mt-2 text-xs text-slate-600">
            The blue line is the estimated hours still to be closed; it drops when a task moves to
            DONE, using the Jira resolution date when there is one. If it sits above the grey line,
            you are behind the theoretical pace. Bars are the hours logged each day. Working days
            only.
          </p>
        </Card>
      ) : (
        <Card title="Burndown">
          <Empty>Set the sprint start and end dates to see the burndown.</Empty>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* ----------------------------------------------------------- proyecto */}
        <Card title="Effort by project">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.byProject} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="project_id" {...AXIS} />
              <YAxis {...AXIS} />
              <Tooltip {...tooltipStyle} cursor={{ fill: '#ffffff08' }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="estimateHours" name="Estimated (h)" fill="#334155" radius={[3, 3, 0, 0]} />
              <Bar dataKey="loggedHours" name="Actual (h)" radius={[3, 3, 0, 0]}>
                {data.byProject.map((r) => (
                  <Cell key={r.project_id} fill={projectColor.get(r.project_id) ?? '#38bdf8'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <table className="mt-3 w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pb-1">Project</th>
                <th className="pb-1 text-right">Tasks</th>
                <th className="pb-1 text-right">Done</th>
                <th className="pb-1 text-right">Pts</th>
                <th className="pb-1 text-right">Est. h</th>
                <th className="pb-1 text-right">Actual h</th>
                <th className="pb-1 text-right">Deviation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-ink-800)]">
              {data.byProject.map((r) => {
                const dev = r.estimateHours ? ((r.loggedHours / r.estimateHours - 1) * 100).toFixed(0) : null;
                return (
                  <tr key={r.project_id}>
                    <td className="py-1.5 font-mono" style={{ color: projectColor.get(r.project_id) }}>
                      {r.project_id}
                    </td>
                    <td className="py-1.5 text-right text-slate-400">{r.tasks}</td>
                    <td className="py-1.5 text-right text-slate-400">{r.tasksDone}</td>
                    <td className="py-1.5 text-right text-slate-400">
                      {r.pointsDone}/{r.points}
                    </td>
                    <td className="py-1.5 text-right text-slate-400">{r.estimateHours}</td>
                    <td className="py-1.5 text-right text-slate-200">{r.loggedHours}</td>
                    <td
                      className={cx(
                        'py-1.5 text-right',
                        dev == null ? 'text-slate-700' : Number(dev) > 15 ? 'text-rose-400' : 'text-emerald-400'
                      )}
                    >
                      {dev == null ? '—' : `${Number(dev) > 0 ? '+' : ''}${dev}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        {/* ------------------------------------------------------------ persona */}
        <Card
          title="Time logged per person"
          actions={
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-600">
                ownership = closed/in progress/total
              </span>
              <Button size="sm" variant="ghost" onClick={onEditCapacity}>
                Edit capacity
              </Button>
            </div>
          }
          className="lg:col-span-2"
        >
          {data.byUser.length === 0 ? (
            <Empty>No time logged yet.</Empty>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart
                  data={data.byUser}
                  layout="vertical"
                  margin={{ top: 8, right: 16, left: 8, bottom: 0 }}
                >
                  <CartesianGrid stroke={GRID} horizontal={false} />
                  <XAxis type="number" {...AXIS} />
                  <YAxis type="category" dataKey="name" width={90} {...AXIS} />
                  <Tooltip {...tooltipStyle} cursor={{ fill: '#ffffff08' }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="capacity" name="Capacity (h)" fill="#273041" radius={[0, 3, 3, 0]} />
                  <Bar dataKey="hours" name="Logged (h)" fill="#38bdf8" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-500">
                      <th className="pb-1">Person</th>
                      <th className="pb-1 text-right" title="Hours logged in this sprint">Hours</th>
                      <th className="pb-1 text-right" title="Hours logged against their sprint capacity">Util.</th>
                      <th className="pb-1 text-right" title="Daily average and busiest day">h/day</th>
                      <th className="pb-1 text-right" title="Distinct tasks they logged time on">Distinct</th>
                      <th className="pb-1 text-right" title="Tasks they own: closed / in progress / total">Ownership</th>
                      <th className="pb-1 text-right" title="Estimated hours of the tasks assigned to them">Own est.</th>
                      <th className="pb-1 text-right" title="Deviation on their own closed tasks">Deviation</th>
                      <th className="pb-1 text-right" title="Share of their time on other people's tasks">Support</th>
                      <th className="pb-1 text-right" title="Share of their time on their main task">Focus</th>
                      <th className="pb-1 text-right" title="Days since their last logged time">Last</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-ink-800)]">
                    {data.byUser.map((u) => (
                      <tr
                        key={u.user_id}
                        onClick={() => setOpenUser(u.user_id)}
                        className="cursor-pointer hover:bg-[var(--color-ink-850)]/60"
                        title="Open this person's detail for the sprint"
                      >
                        <td className="py-1.5 text-sky-400 hover:text-sky-300">{u.name} ›</td>
                        <td className="py-1.5 text-right text-slate-200">{u.hours}</td>
                        <td
                          className={cx(
                            'py-1.5 text-right',
                            u.utilization == null
                              ? 'text-slate-700'
                              : u.utilization > 100
                                ? 'text-rose-400'
                                : u.utilization < 60
                                  ? 'text-amber-400'
                                  : 'text-emerald-400'
                          )}
                        >
                          {u.utilization == null ? '—' : `${u.utilization}%`}
                        </td>
                        <td className="py-1.5 text-right text-slate-400">
                          {u.avgPerDay}
                          <span className="ml-1 text-slate-700">/{u.maxDay}</span>
                        </td>
                        <td
                          className={cx(
                            'py-1.5 text-right',
                            u.distinctTasks >= 8 ? 'text-amber-400' : 'text-slate-400'
                          )}
                        >
                          {u.distinctTasks}
                        </td>
                        <td className="py-1.5 text-right">
                          {u.tasksAssigned === 0 ? (
                            <span className="text-slate-700">—</span>
                          ) : (
                            <span className="text-slate-300">
                              {u.tasksDone}
                              <span className="text-slate-600">/{u.tasksInProgress}/</span>
                              {u.tasksAssigned}
                              {u.tasksBlocked > 0 && (
                                <span className="ml-1 text-rose-400" title="blocked">
                                  ⛔{u.tasksBlocked}
                                </span>
                              )}
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 text-right text-slate-500">
                          {u.ownedEstimate || '—'}
                        </td>
                        <td
                          className={cx(
                            'py-1.5 text-right',
                            u.ownDoneTasks === 0
                              ? 'text-slate-700'
                              : u.ownDelta > 0
                                ? 'text-rose-400'
                                : u.ownDelta < 0
                                  ? 'text-amber-400'
                                  : 'text-emerald-400'
                          )}
                          title={
                            u.ownDoneTasks
                              ? `${u.ownLoggedDone} h actual against ${u.ownEstimateDone} h estimated across ${u.ownDoneTasks} closed tasks`
                              : 'no closed tasks of their own'
                          }
                        >
                          {u.ownDoneTasks === 0
                            ? '—'
                            : `${u.ownDelta > 0 ? '+' : ''}${u.ownDelta} h`}
                        </td>
                        <td
                          className={cx(
                            'py-1.5 text-right',
                            (u.supportPct ?? 0) >= 40 ? 'text-amber-400' : 'text-slate-500'
                          )}
                          title={`${u.supportHours} h on other people's tasks`}
                        >
                          {u.supportPct == null ? '—' : `${u.supportPct}%`}
                        </td>
                        <td
                          className="py-1.5 text-right text-slate-500"
                          title={u.topTaskKey ? `${u.topTaskHours} h on ${u.topTaskKey}` : ''}
                        >
                          {u.focusPct == null ? '—' : `${u.focusPct}%`}
                        </td>
                        <td
                          className={cx(
                            'py-1.5 text-right',
                            (u.idleDays ?? 0) >= 3 ? 'text-amber-400' : 'text-slate-600'
                          )}
                          title={u.lastDay ? `last logged ${u.lastDay}` : ''}
                        >
                          {u.idleDays == null ? '—' : `${u.idleDays}d`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>

        {/* ------------------------------------------------------- tipo y estado */}
        <Card title="Effort split by type of work">
          <div className="flex items-center gap-4">
            <ResponsiveContainer width="55%" height={220}>
              <PieChart>
                <Pie
                  data={data.byType.filter((r) => r.hours > 0)}
                  dataKey="hours"
                  nameKey="type"
                  innerRadius={50}
                  outerRadius={85}
                  paddingAngle={2}
                  stroke="none"
                >
                  {data.byType.map((r) => (
                    <Cell key={r.type} fill={typeMeta(r.type).color} />
                  ))}
                </Pie>
                <Tooltip {...tooltipStyle} formatter={(v: any) => `${v} h`} />
              </PieChart>
            </ResponsiveContainer>
            <ul className="flex-1 space-y-2 text-xs">
              {data.byType.map((r) => (
                <li key={r.type} className="flex items-center gap-2">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: typeMeta(r.type).color }}
                  />
                  <span className="text-slate-300">{typeMeta(r.type).label}</span>
                  <span className="ml-auto text-slate-500">
                    {r.hours} h · {r.pctHours}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-2 text-xs text-slate-600">
            If bugs plus support eat more than 30% of the sprint, you have a quality or interruption
            problem worth taking to the retro.
          </p>
        </Card>

        <Card title="Task status">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.byStatus} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="status" tickFormatter={(s) => statusMeta(s).label} {...AXIS} />
              <YAxis {...AXIS} />
              <Tooltip {...tooltipStyle} cursor={{ fill: '#ffffff08' }} labelFormatter={(s) => statusMeta(s).label} />
              <Bar dataKey="tasks" name="Tasks" radius={[3, 3, 0, 0]}>
                {data.byStatus.map((r) => (
                  <Cell key={r.status} fill={statusMeta(r.status).color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <UserDetail
        sprintId={sprintId}
        userId={openUser}
        projects={projects}
        onClose={() => setOpenUser(null)}
      />

      {/* --------------------------- velocidad real y previsión de compromiso */}
      <Card
        title="Real velocity and next sprint"
        actions={
          <span className="text-xs text-slate-500">
            measured in estimated hours actually closed
          </span>
        }
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label="Real velocity"
            value={`${data.velocity.deliveredEstimate} h`}
            sub={`${data.velocity.tasksDone} of ${data.velocity.tasksTotal} tasks closed`}
            tone="good"
          />
          <Stat
            label="Delivery ratio"
            value={data.velocity.deliveryRatio == null ? '—' : `${data.velocity.deliveryRatio}%`}
            sub={`of ${data.velocity.committedEstimate} h committed`}
            tone={
              (data.velocity.deliveryRatio ?? 0) >= 80
                ? 'good'
                : (data.velocity.deliveryRatio ?? 0) >= 60
                  ? 'warn'
                  : 'bad'
            }
          />
          <Stat
            label="Typical task"
            value={`${data.velocity.medianEstimateDone ?? '—'} h`}
            sub={`median · ${data.velocity.avgEstimateDone ?? '—'} h average`}
          />
          <Stat
            label="Cost of an estimated hour"
            value={data.velocity.estimateFactor ?? '—'}
            sub={`${data.velocity.loggedOnDone} h real for ${data.deviation.estimateDone} h estimated`}
            tone={
              data.velocity.estimateFactor == null
                ? 'default'
                : data.velocity.estimateFactor > 1.15
                  ? 'bad'
                  : data.velocity.estimateFactor < 0.85
                    ? 'warn'
                    : 'good'
            }
          />
        </div>

        {/* reparto por tamaño de estimación */}
        <div className="mt-4">
          <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Closed by estimate size
          </h4>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pb-1">Estimate</th>
                <th className="pb-1 text-right">Closed</th>
                <th className="pb-1 text-right">Total</th>
                <th className="pb-1">Completion</th>
                <th className="pb-1 text-right">Delivered</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-ink-800)]">
              {data.doneByEstimate.map((r) => (
                <tr key={r.estimate}>
                  <td className="py-1 text-slate-300">
                    {r.estimate === 0 ? <span className="text-slate-600">unestimated</span> : `${r.estimate} h`}
                  </td>
                  <td className="py-1 text-right text-slate-200">{r.done}</td>
                  <td className="py-1 text-right text-slate-500">{r.total}</td>
                  <td className="py-1">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--color-ink-800)]">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${r.pctDone}%`,
                            backgroundColor: r.pctDone >= 75 ? '#34d399' : r.pctDone >= 50 ? '#fbbf24' : '#f43f5e',
                          }}
                        />
                      </div>
                      <span className="text-slate-500">{r.pctDone}%</span>
                    </div>
                  </td>
                  <td className="py-1 text-right text-slate-400">{r.deliveredHours} h</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-600">
            Which task sizes actually flow. A size that stalls while smaller ones close is a sign it
            should be sliced before entering the sprint.
          </p>
        </div>

        {/* previsión */}
        <div className="mt-4 rounded-lg border border-[var(--color-ink-700)] bg-[var(--color-ink-900)]/60 p-3">
          <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
            <h4 className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              How much to commit next sprint
            </h4>
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <span>Confidence factor</span>
              <input
                type="number"
                min="0.1"
                max="3"
                step="0.05"
                className="w-20 text-right"
                value={factorDraft}
                onChange={(e) => setFactorDraft(e.target.value)}
              />
              <Button
                size="sm"
                disabled={saveFactor.isPending || Number(factorDraft) === data.forecast.commitFactor}
                onClick={() => saveFactor.mutate(Number(factorDraft))}
              >
                {saveFactor.isPending ? 'Saving…' : 'Apply'}
              </Button>
            </label>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-emerald-900/50 bg-emerald-950/20 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Recommended</div>
              <div className="text-2xl font-semibold text-emerald-400">
                {data.forecast.recommended} h
              </div>
              <div className="text-[11px] text-slate-500">
                of estimate
                {data.forecast.equivalentTasks != null &&
                  ` · about ${data.forecast.equivalentTasks} tasks of the usual size`}
              </div>
            </div>
            <div className="rounded-lg border border-[var(--color-ink-800)] px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">
                By expected hours
              </div>
              <div className="text-xl font-semibold text-slate-300">
                {data.forecast.byExpectedHours ?? '—'} h
              </div>
              <div className="text-[11px] text-slate-600">
                {data.forecast.deliveryCapacity} h delivery × {data.forecast.utilisation}% used ÷{' '}
                {data.forecast.estimateFactor}
              </div>
            </div>
            <div className="rounded-lg border border-[var(--color-ink-800)] px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">
                Capacity ceiling
              </div>
              <div className="text-xl font-semibold text-slate-500">
                {data.forecast.capacityCeiling ?? '—'} h
              </div>
              <div className="text-[11px] text-slate-600">theoretical maximum, not a target</div>
            </div>
          </div>

          <p className="mt-2 text-xs text-slate-600">
            The recommendation is the empirical one: what the team actually closed, times the
            confidence factor. It already contains the blockers, interruptions and everything that
            never gets planned, which is why it is lower than the other two. Raise the factor to
            push on purpose, lower it to play safe; it is saved with the sprint.
          </p>
        </div>
      </Card>

      {/* ------------------------------------------- desviación de tiempo */}
      {data.deviation.tasksCompared > 0 && (
        <Card
          title="Time deviation"
          actions={
            <span className="text-xs text-slate-500">
              across {data.deviation.tasksCompared} closed, estimated tasks
            </span>
          }
        >
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="Net deviation"
              value={`${data.deviation.deltaDone >= 0 ? '+' : ''}${data.deviation.deltaDone} h`}
              sub={`${data.deviation.loggedDone} h actual of ${data.deviation.estimateDone} h`}
              tone={
                Math.abs(data.deviation.deviationPct ?? 0) <= 15
                  ? 'good'
                  : (data.deviation.deviationPct ?? 0) > 0
                    ? 'bad'
                    : 'warn'
              }
            />
            <Stat
              label="Overrun"
              value={`${data.deviation.overrunHours} h`}
              sub={`${data.deviation.overrunTasks} tasks went over`}
              tone={data.deviation.overrunTasks ? 'bad' : 'good'}
            />
            <Stat
              label="Underrun"
              value={`${data.deviation.underrunHours} h`}
              sub={`${data.deviation.underrunTasks} tasks cost less`}
              tone={data.deviation.underrunTasks ? 'warn' : 'default'}
            />
            <Stat
              label="Open and already over"
              value={`${data.deviation.openOverrunHours} h`}
              sub={`${data.deviation.openOverrunTasks} tasks still open`}
              tone={data.deviation.openOverrunTasks ? 'bad' : 'good'}
            />
          </div>
          <p className="mt-2 text-xs text-slate-600">
            Overrun and underrun are not netted off on purpose: a net of zero does not mean good
            estimation, it means being wrong in both directions.
          </p>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {[
              { title: 'Went over the estimate', rows: data.deviation.worstOverrun, bad: true },
              { title: 'Cost considerably less', rows: data.deviation.worstUnderrun, bad: false },
            ].map((b) => (
              <div key={b.title}>
                <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  {b.title}
                </h4>
                {b.rows.length === 0 ? (
                  <p className="text-xs text-slate-600">None.</p>
                ) : (
                  <table className="w-full text-xs">
                    <tbody className="divide-y divide-[var(--color-ink-800)]">
                      {b.rows.map((r) => (
                        <tr key={r.key}>
                          <td className="py-1 font-mono" style={{ color: projectColor.get(r.project_id) }}>
                            {r.key}
                          </td>
                          <td className="py-1 max-w-56 truncate text-slate-600">{r.title}</td>
                          <td className="py-1 text-right text-slate-500">
                            {r.logged_hours} / {r.estimate_hours} h
                          </td>
                          <td className={cx('py-1 text-right', b.bad ? 'text-rose-400' : 'text-amber-400')}>
                            {r.delta > 0 ? '+' : ''}
                            {r.delta} h
                          </td>
                          <td className="py-1 text-right text-slate-600">×{r.ratio}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </div>

          {data.deviation.openOverrun.length > 0 && (
            <div className="mt-4">
              <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Still open and already over the estimate
              </h4>
              <table className="w-full text-xs">
                <tbody className="divide-y divide-[var(--color-ink-800)]">
                  {data.deviation.openOverrun.map((r) => (
                    <tr key={r.key}>
                      <td className="py-1 font-mono" style={{ color: projectColor.get(r.project_id) }}>
                        {r.key}
                      </td>
                      <td className="py-1">
                        <Badge color={statusMeta(r.status).color}>{statusMeta(r.status).label}</Badge>
                      </td>
                      <td className="py-1 max-w-56 truncate text-slate-600">{r.title}</td>
                      <td className="py-1 text-right text-slate-500">
                        {r.logged_hours} / {r.estimate_hours} h
                      </td>
                      <td className="py-1 text-right text-rose-400">+{r.delta} h</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* ------------------------------------------------- desviaciones grandes */}
      <Card title="Largest estimate deviations">
        {data.estimateOutliers.length === 0 ? (
          <Empty>You need an estimate in hours and logged time to compare.</Empty>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pb-1">Task</th>
                <th className="pb-1">Project</th>
                <th className="pb-1 text-right">Estimated</th>
                <th className="pb-1 text-right">Actual</th>
                <th className="pb-1 text-right">Deviation</th>
                <th className="pb-1 text-right">Ratio</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-ink-800)]">
              {data.estimateOutliers.map((o) => (
                <tr key={o.key}>
                  <td className="py-1.5">
                    <span className="font-mono text-slate-300">{o.key}</span>
                    {o.title && <span className="ml-2 text-slate-600">{o.title}</span>}
                  </td>
                  <td className="py-1.5 font-mono" style={{ color: projectColor.get(o.project_id) }}>
                    {o.project_id}
                  </td>
                  <td className="py-1.5 text-right text-slate-400">{o.estimate_hours} h</td>
                  <td className="py-1.5 text-right text-slate-200">{o.logged_hours} h</td>
                  <td className={cx('py-1.5 text-right', o.delta > 0 ? 'text-rose-400' : 'text-emerald-400')}>
                    {o.delta > 0 ? '+' : ''}
                    {o.delta} h
                  </td>
                  <td className="py-1.5 text-right text-slate-500">×{o.ratio}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
