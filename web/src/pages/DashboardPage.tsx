import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../lib/api';
import { Badge, Card, Empty, Stat } from '../components/ui';

const AXIS = { stroke: '#475569', fontSize: 11 };
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

export default function DashboardPage() {
  const sprints = useQuery({ queryKey: ['sprints'], queryFn: api.sprints.list });
  const velocity = useQuery({ queryKey: ['velocity'], queryFn: api.velocity });

  const rows = (velocity.data ?? []).map((r) => ({
    ...r,
    total_points: Number(r.total_points),
    completed_points: Number(r.completed_points),
    logged_hours: Number(r.logged_hours),
    hoursPerPoint: Number(r.completed_points) ? +(Number(r.logged_hours) / Number(r.completed_points)).toFixed(2) : null,
  }));

  const closed = rows.filter((r) => r.status === 'closed' && r.completed_points > 0);
  const avgVelocity = closed.length
    ? +(closed.reduce((a, r) => a + r.completed_points, 0) / closed.length).toFixed(1)
    : null;
  const avgHoursPerPoint = closed.length
    ? +(
        closed.reduce((a, r) => a + r.logged_hours, 0) / closed.reduce((a, r) => a + r.completed_points, 0)
      ).toFixed(2)
    : null;

  const active = (sprints.data ?? []).find((s) => s.status === 'active') ?? sprints.data?.[0];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <h1 className="text-xl font-semibold text-slate-100">Dashboard</h1>

      {active ? (
        <Card
          title="Current sprint"
          actions={
            <Link
              to={`/sprints/${encodeURIComponent(active.id)}?tab=metrics`}
              className="text-xs text-sky-400 hover:text-sky-300"
            >
              View metrics →
            </Link>
          }
        >
          <div className="flex flex-wrap items-center gap-3">
            <Link
              to={`/sprints/${encodeURIComponent(active.id)}`}
              className="text-lg font-medium text-slate-100 hover:text-sky-300"
            >
              {active.name}
            </Link>
            <Badge color={active.status === 'active' ? '#38bdf8' : '#64748b'}>{active.status}</Badge>
            <span className="text-xs text-slate-500">
              {active.start_date ?? '?'} → {active.end_date ?? '?'}
            </span>
            <span className="text-xs text-slate-500">{active.task_count ?? 0} tasks</span>
            {active.goal && <span className="text-sm italic text-slate-500">«{active.goal}»</span>}
          </div>
        </Card>
      ) : (
        <Empty>
          No sprints yet.{' '}
          <Link to="/sprints" className="text-sky-400">
            Create the first one
          </Link>
          .
        </Empty>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Sprints recorded" value={rows.length} />
        <Stat label="Average velocity" value={avgVelocity ?? '—'} sub="pts / closed sprint" />
        <Stat label="Hours per point" value={avgHoursPerPoint ?? '—'} sub="historical average" />
        <Stat
          label="Hours recorded"
          value={rows.reduce((a, r) => a + r.logged_hours, 0).toFixed(0)}
          sub="across all sprints"
        />
      </div>

      <Card title="Trend across sprints">
        {rows.length === 0 ? (
          <Empty>No data yet.</Empty>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={rows} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                <CartesianGrid stroke="#1a2130" vertical={false} />
                <XAxis dataKey="name" {...AXIS} />
                <YAxis yAxisId="pts" {...AXIS} />
                <YAxis yAxisId="h" orientation="right" {...AXIS} />
                <Tooltip {...tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="pts" dataKey="total_points" name="Committed (pts)" fill="#273041" radius={[3, 3, 0, 0]} />
                <Bar yAxisId="pts" dataKey="completed_points" name="Completed (pts)" fill="#38bdf8" radius={[3, 3, 0, 0]} />
                <Line yAxisId="h" type="monotone" dataKey="logged_hours" name="Actual hours" stroke="#a78bfa" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
            <p className="mt-2 text-xs text-slate-600">
              Once three sprints are closed you can use the average to size the next one.
            </p>
          </>
        )}
      </Card>

      <Card title="Sprint by sprint">
        {rows.length === 0 ? (
          <Empty>No sprints.</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="pb-2">Sprint</th>
                <th className="pb-2">Dates</th>
                <th className="pb-2 text-right">Tasks</th>
                <th className="pb-2 text-right">Pts</th>
                <th className="pb-2 text-right">Est. h</th>
                <th className="pb-2 text-right">Actual h</th>
                <th className="pb-2 text-right">h/pt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-ink-800)]">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-2">
                    <Link to={`/sprints/${encodeURIComponent(r.id)}?tab=metrics`} className="text-sky-400 hover:text-sky-300">
                      {r.name}
                    </Link>
                  </td>
                  <td className="py-2 text-xs text-slate-500">
                    {r.start_date ?? '?'} → {r.end_date ?? '?'}
                  </td>
                  <td className="py-2 text-right text-slate-400">
                    {r.tasks_done}/{r.tasks}
                  </td>
                  <td className="py-2 text-right text-slate-300">
                    {r.completed_points}/{r.total_points}
                  </td>
                  <td className="py-2 text-right text-slate-500">{Number(r.estimate_hours).toFixed(1)}</td>
                  <td className="py-2 text-right text-slate-200">{r.logged_hours.toFixed(1)}</td>
                  <td className="py-2 text-right text-slate-500">{r.hoursPerPoint ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
