import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Badge, Button, Card, Empty, ErrorBanner, Field } from '../components/ui';

const SPRINT_STATUS: Record<string, { label: string; color: string }> = {
  planned: { label: 'Planned', color: '#64748b' },
  active: { label: 'Active', color: '#38bdf8' },
  closed: { label: 'Closed', color: '#34d399' },
};

const addDaysIso = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export default function SprintsPage() {
  const qc = useQueryClient();
  const { data: sprints = [] } = useQuery({ queryKey: ['sprints'], queryFn: api.sprints.list });

  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [start, setStart] = useState(new Date().toISOString().slice(0, 10));
  const [end, setEnd] = useState(addDaysIso(new Date().toISOString().slice(0, 10), 13));
  const [goal, setGoal] = useState('');

  const invalidate = () => qc.invalidateQueries({ queryKey: ['sprints'] });

  const create = useMutation({
    mutationFn: () =>
      api.sprints.create({
        id: id.trim(),
        name: name.trim() || id.trim(),
        start_date: start || null,
        end_date: end || null,
        goal: goal.trim() || null,
      }),
    onSuccess: () => {
      setId('');
      setName('');
      setGoal('');
      invalidate();
    },
  });

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: any }) => api.sprints.update(id, patch),
    onSuccess: invalidate,
  });
  const remove = useMutation({ mutationFn: api.sprints.remove, onSuccess: invalidate });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <h1 className="text-xl font-semibold text-slate-100">Sprints</h1>

      <Card title="New sprint">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
          className="flex flex-col gap-3"
        >
          <ErrorBanner error={create.error} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <Field label="Id *">
              <input value={id} onChange={(e) => setId(e.target.value)} placeholder="S-2026-14" required />
            </Field>
            <Field label="Name">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sprint 14" />
            </Field>
            <Field label="Start *" hint="needed for the burndown">
              <input
                type="date"
                value={start}
                onChange={(e) => {
                  setStart(e.target.value);
                  if (e.target.value) setEnd(addDaysIso(e.target.value, 13));
                }}
              />
            </Field>
            <Field label="End *">
              <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </Field>
          </div>
          <Field label="Sprint goal">
            <input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Sprint goal" />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" variant="primary" disabled={create.isPending}>
              Create sprint
            </Button>
          </div>
        </form>
      </Card>

      <Card title={`History (${sprints.length})`}>
        <ErrorBanner error={remove.error ?? update.error} />
        {sprints.length === 0 ? (
          <Empty>Create your first sprint to get going.</Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {sprints.map((s) => {
              const meta = SPRINT_STATUS[s.status] ?? SPRINT_STATUS.planned;
              return (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-ink-800)] bg-[var(--color-ink-850)]/50 px-3 py-2.5"
                >
                  <Link
                    to={`/sprints/${encodeURIComponent(s.id)}`}
                    className="font-medium text-sky-400 hover:text-sky-300"
                  >
                    {s.name}
                  </Link>
                  <span className="font-mono text-xs text-slate-600">{s.id}</span>
                  <Badge color={meta.color}>{meta.label}</Badge>
                  <span className="text-xs text-slate-500">
                    {s.start_date ?? '?'} → {s.end_date ?? '?'}
                  </span>
                  <span className="text-xs text-slate-500">{s.task_count ?? 0} tasks</span>
                  {s.goal && <span className="flex-1 truncate text-xs text-slate-600">{s.goal}</span>}
                  <div className="ml-auto flex items-center gap-2">
                    <select
                      value={s.status}
                      onChange={(e) => update.mutate({ id: s.id, patch: { status: e.target.value } })}
                      className="text-xs"
                    >
                      <option value="planned">Planned</option>
                      <option value="active">Active</option>
                      <option value="closed">Closed</option>
                    </select>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() =>
                        confirm(`Delete ${s.name} with all its tasks and logged time?`) && remove.mutate(s.id)
                      }
                    >
                      Borrar
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
