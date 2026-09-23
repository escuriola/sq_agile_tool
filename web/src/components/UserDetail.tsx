import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../lib/api';
import { statusMeta, trackMeta, typeMeta, type Project } from '../lib/types';
import { hoursToHm } from '../lib/format';
import { Badge, Empty, Modal, Stat, cx } from './ui';

const AXIS = { stroke: '#475569', fontSize: 11 };
const shortDate = (d: string) => d.slice(5).replace('-', '/');

/**
 * No enseña nada en los días sin dato. Sin esto, pasar el ratón por un día
 * futuro del sprint sacaba un tooltip vacío que parecía una imputación.
 */
function DayTooltip({ active, payload, label }: any) {
  const v = payload?.[0]?.value;
  if (!active || v == null) return null;
  return (
    <div className="rounded-lg border border-[var(--color-ink-700)] bg-[var(--color-ink-850)] px-2.5 py-1.5 text-xs">
      <div className="text-slate-400">{label}</div>
      <div className="text-slate-100">{v} h</div>
    </div>
  );
}

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

/** Detalle de una persona dentro del sprint: en qué ha trabajado y cómo reparte su tiempo. */
export function UserDetail({
  sprintId,
  userId,
  projects,
  onClose,
}: {
  sprintId: string;
  userId: string | null;
  projects: Project[];
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['userDetail', sprintId, userId],
    queryFn: () => api.sprints.userDetail(sprintId, userId!),
    enabled: !!userId,
  });

  const projectColor = new Map(projects.map((p) => [p.id, p.color ?? '#38bdf8']));
  // Mismo criterio que el burndown: en fin de semana no se imputa, así que
  // pintarlos sólo mete columnas vacías que estorban la lectura.
  const laborables = (data?.daily ?? []).filter((d) => !d.weekend);

  return (
    <Modal open={!!userId} onClose={onClose} wide title={data ? data.user.name : 'Cargando…'}>
      {isLoading || !data ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : data.totals.distinctTasks === 0 ? (
        <Empty>No hours logged in this sprint.</Empty>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              label="Logged"
              value={`${data.totals.hours} h`}
              sub={data.totals.capacity ? `of ${data.totals.capacity} h` : 'no capacity set'}
            />
            <Stat
              label="Utilisation"
              value={data.totals.utilization == null ? '—' : `${data.totals.utilization}%`}
              tone={
                data.totals.utilization == null
                  ? 'default'
                  : data.totals.utilization > 100
                    ? 'bad'
                    : data.totals.utilization < 60
                      ? 'warn'
                      : 'good'
              }
            />
            <Stat
              label="Tasks touched"
              value={data.totals.distinctTasks}
              sub={`${data.totals.entries} entries`}
              tone={data.totals.distinctTasks >= 8 ? 'warn' : 'default'}
            />
            <Stat
              label="Daily average"
              value={`${data.totals.avgPerDay} h`}
              sub={`${data.totals.daysWorked} days · peak ${data.totals.maxDay} h`}
            />
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg border border-[var(--color-ink-800)] bg-[var(--color-ink-900)]/60 px-3 py-2 text-xs text-slate-500">
            <span>
              Owns <strong className="text-slate-300">{data.totals.ownedTasks}</strong> tasks
              {data.totals.ownedTasks > 0 && ` (${data.totals.ownedDone} closed)`}
            </span>
            {data.totals.hoursOnOthers > 0 && (
              <span>
                <strong className="text-slate-300">{data.totals.hoursOnOthers} h</strong> on other
                people's tasks
              </span>
            )}
          </div>

          {/* esfuerzo diario */}
          <div>
            <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Daily effort
            </h4>
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={laborables} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
                <CartesianGrid stroke="#1a2130" vertical={false} />
                <XAxis dataKey="date" tickFormatter={shortDate} {...AXIS} />
                <YAxis {...AXIS} />
                <Tooltip content={<DayTooltip />} cursor={{ fill: '#ffffff08' }} />
                <Bar dataKey="hours" fill="#38bdf8" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* repartos */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              { title: 'By project', rows: data.byProject, color: (k: string) => projectColor.get(k) ?? '#38bdf8' },
              { title: 'By type', rows: data.byType, color: (k: string) => typeMeta(k).color },
              { title: 'By track', rows: data.byTrack, color: (k: string) => trackMeta(k).color },
            ].map((block) => (
              <div
                key={block.title}
                className="rounded-lg border border-[var(--color-ink-800)] bg-[var(--color-ink-850)]/40 p-3"
              >
                <h4 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  {block.title}
                </h4>
                <ul className="space-y-1.5 text-xs">
                  {block.rows.map((r) => {
                    const pct = data.totals.hours ? (r.hours / data.totals.hours) * 100 : 0;
                    const label =
                      block.title === 'By type'
                        ? typeMeta(r.key).label
                        : block.title === 'By track'
                          ? trackMeta(r.key).label
                          : r.key;
                    return (
                      <li key={r.key}>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-slate-300">{label}</span>
                          <span className="text-slate-500">
                            {r.hours} h · {pct.toFixed(0)}%
                          </span>
                        </div>
                        <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-[var(--color-ink-800)]">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${pct}%`, backgroundColor: block.color(r.key) }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>

          {/* tareas */}
          <div>
            <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Tasks worked on ({data.tasks.length})
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="pb-1">Task</th>
                    <th className="pb-1">Status</th>
                    <th className="pb-1 text-right">Theirs</th>
                    <th className="pb-1 text-right">Task total</th>
                    <th className="pb-1 text-right">% theirs</th>
                    <th className="pb-1 text-right">Est.</th>
                    <th className="pb-1">Dates</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-ink-800)]">
                  {data.tasks.map((t) => (
                    <tr key={t.key}>
                      <td className="py-1.5">
                        <span className="font-mono" style={{ color: projectColor.get(t.project_id) }}>
                          {t.key}
                        </span>
                        {t.isOwner && (
                          <span className="ml-1.5 text-[10px] text-sky-400" title="They own it">
                            ★
                          </span>
                        )}
                        {t.blocked && <span className="ml-1 text-[10px] text-rose-400">⛔</span>}
                        {t.title && (
                          <div className="max-w-72 truncate text-[11px] text-slate-600">{t.title}</div>
                        )}
                      </td>
                      <td className="py-1.5">
                        <Badge color={statusMeta(t.status).color}>{statusMeta(t.status).label}</Badge>
                      </td>
                      <td className="py-1.5 text-right text-slate-200" title={hoursToHm(t.myHours)}>
                        {t.myHours}
                      </td>
                      <td className="py-1.5 text-right text-slate-500">
                        {t.taskHours}
                        {t.people > 1 && (
                          <span className="ml-1 text-slate-700">({t.people}p)</span>
                        )}
                      </td>
                      <td
                        className={cx(
                          'py-1.5 text-right',
                          t.sharePct >= 80 ? 'text-slate-300' : 'text-amber-500/80'
                        )}
                      >
                        {t.sharePct}%
                      </td>
                      <td className="py-1.5 text-right text-slate-500">{t.estimate_hours ?? '—'}</td>
                      <td className="py-1.5 text-slate-600">
                        {t.firstDate === t.lastDate
                          ? shortDate(t.firstDate)
                          : `${shortDate(t.firstDate)}–${shortDate(t.lastDate)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* apuntes */}
          <details className="text-xs">
            <summary className="cursor-pointer text-slate-500 hover:text-slate-300">
              View the {data.entries.length} entries with their descriptions
            </summary>
            <table className="mt-1 w-full">
              <tbody className="divide-y divide-[var(--color-ink-800)]">
                {data.entries.map((e, i) => (
                  <tr key={i}>
                    <td className="w-16 py-1 text-slate-600">{shortDate(e.date)}</td>
                    <td className="w-28 py-1 font-mono text-slate-400">{e.task_key}</td>
                    <td className="w-14 py-1 text-right text-slate-300">{hoursToHm(e.hours)}</td>
                    <td className="py-1 text-slate-500">{e.note ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      )}
    </Modal>
  );
}
