import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { User } from '../lib/types';
import { Button, Card, Empty, ErrorBanner, Field } from '../components/ui';

export default function UsersPage() {
  const qc = useQueryClient();
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: api.users.list });

  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [capacity, setCapacity] = useState('');

  const invalidate = () => qc.invalidateQueries({ queryKey: ['users'] });

  const create = useMutation({
    mutationFn: () =>
      api.users.create({
        id: id.trim(),
        name: name.trim(),
        capacity_hours: capacity.trim() ? Number(capacity) : null,
      }),
    onSuccess: () => {
      setId('');
      setName('');
      setCapacity('');
      invalidate();
    },
  });

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<User> }) => api.users.update(id, patch),
    onSuccess: invalidate,
  });

  const remove = useMutation({ mutationFn: api.users.remove, onSuccess: invalidate });

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <h1 className="text-xl font-semibold text-slate-100">Users</h1>

      <Card title="New user">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
          className="flex flex-col gap-3"
        >
          <ErrorBanner error={create.error} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <Field label="Id *" hint="short and stable">
              <input value={id} onChange={(e) => setId(e.target.value)} placeholder="jlopez" required />
            </Field>
            <Field label="Name *" className="sm:col-span-2">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" required />
            </Field>
            <Field label="Default capacity" hint="h/sprint; adjusted per sprint later">
              <input
                type="number"
                step="1"
                min="0"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                placeholder="60"
              />
            </Field>
          </div>
          <div className="flex justify-end">
            <Button type="submit" variant="primary" disabled={create.isPending}>
              Create user
            </Button>
          </div>
        </form>
      </Card>

      <Card
        title={`Team (${users.length})`}
        actions={
          <span className="text-xs text-slate-600">
            Each sprint's real capacity is set from within that sprint
          </span>
        }
      >
        <ErrorBanner error={update.error ?? remove.error} />
        {users.length === 0 ? (
          <Empty>No users yet.</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="pb-2">Id</th>
                <th className="pb-2">Name</th>
                <th className="pb-2">Default capacity</th>
                <th className="pb-2">Status</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-ink-800)]">
              {users.map((u) => (
                <tr key={u.id} className={u.active ? '' : 'opacity-45'}>
                  <td className="py-2 font-mono text-xs text-slate-400">{u.id}</td>
                  <td className="py-2 text-slate-200">{u.name}</td>
                  <td className="py-2 text-slate-400">{u.capacity_hours ?? '—'} h</td>
                  <td className="py-2 text-slate-400">{u.active ? 'Active' : 'Inactive'}</td>
                  <td className="py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => update.mutate({ id: u.id, patch: { active: !u.active } })}
                      >
                        {u.active ? 'Deactivate' : 'Activate'}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() =>
                          confirm(`Delete ${u.name}? This fails if they have logged time.`) &&
                          remove.mutate(u.id)
                        }
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
