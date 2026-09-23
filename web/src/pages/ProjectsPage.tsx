import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Button, Card, Empty, ErrorBanner, Field } from '../components/ui';

export default function ProjectsPage() {
  const qc = useQueryClient();
  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: api.projects.list });

  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [color, setColor] = useState('#38bdf8');

  const invalidate = () => qc.invalidateQueries({ queryKey: ['projects'] });

  const create = useMutation({
    mutationFn: () => api.projects.create({ id: id.trim(), name: name.trim() || id.trim(), color }),
    onSuccess: () => {
      setId('');
      setName('');
      invalidate();
    },
  });
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: any }) => api.projects.update(id, patch),
    onSuccess: invalidate,
  });
  const remove = useMutation({ mutationFn: api.projects.remove, onSuccess: invalidate });

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <h1 className="text-xl font-semibold text-slate-100">Projects</h1>

      <Card title="New project">
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
              <input value={id} onChange={(e) => setId(e.target.value)} placeholder="EMA" required />
            </Field>
            <Field label="Name" className="sm:col-span-2">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Same as the id if left empty" />
            </Field>
            <Field label="Colour">
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 p-1" />
            </Field>
          </div>
          <div className="flex justify-end">
            <Button type="submit" variant="primary" disabled={create.isPending}>
              Create project
            </Button>
          </div>
        </form>
      </Card>

      <Card title={`Projects (${projects.length})`}>
        <ErrorBanner error={remove.error ?? update.error} />
        {projects.length === 0 ? (
          <Empty>No projects.</Empty>
        ) : (
          <ul className="divide-y divide-[var(--color-ink-800)]">
            {projects.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2.5">
                <input
                  type="color"
                  value={p.color ?? '#38bdf8'}
                  onChange={(e) => update.mutate({ id: p.id, patch: { color: e.target.value } })}
                  className="h-7 w-9 shrink-0 p-1"
                  title="Colour"
                />
                <span className="font-mono text-sm text-slate-200">{p.id}</span>
                <span className="flex-1 text-sm text-slate-500">{p.name}</span>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() =>
                    confirm(`Delete ${p.id}? This fails if it has tasks attached.`) && remove.mutate(p.id)
                  }
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
