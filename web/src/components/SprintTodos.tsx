import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { SprintTodo } from '../lib/types';
import { Button, Card, Empty, ErrorBanner, cx } from './ui';

const hoy = () => new Date().toISOString().slice(0, 10);
const vencida = (t: SprintTodo) => !!t.due_date && !t.done && t.due_date < hoy();

function Fila({
  t,
  mostrarSprint,
  onToggle,
  onEdit,
  onDelete,
  onMover,
}: {
  t: SprintTodo;
  mostrarSprint?: boolean;
  onToggle: () => void;
  onEdit: (patch: Partial<SprintTodo>) => void;
  onDelete: () => void;
  onMover?: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const [titulo, setTitulo] = useState(t.title);

  const guardar = () => {
    const v = titulo.trim();
    setEditando(false);
    if (v && v !== t.title) onEdit({ title: v });
    else setTitulo(t.title);
  };

  return (
    <li className="group flex items-start gap-2.5 rounded-lg border border-[var(--color-ink-800)] bg-[var(--color-ink-850)]/40 px-3 py-2">
      <input
        type="checkbox"
        checked={t.done}
        onChange={onToggle}
        className="mt-0.5 size-4 shrink-0 accent-emerald-500"
        aria-label={t.done ? 'Mark as pending' : 'Mark as done'}
      />

      <div className="min-w-0 flex-1">
        {editando ? (
          <input
            value={titulo}
            autoFocus
            onChange={(e) => setTitulo(e.target.value)}
            onBlur={guardar}
            onKeyDown={(e) => {
              if (e.key === 'Enter') guardar();
              if (e.key === 'Escape') {
                setTitulo(t.title);
                setEditando(false);
              }
            }}
            className="w-full text-sm"
          />
        ) : (
          <button
            onClick={() => setEditando(true)}
            className={cx(
              'text-left text-sm',
              t.done ? 'text-slate-600 line-through' : 'text-slate-200 hover:text-sky-300'
            )}
          >
            {t.title}
          </button>
        )}

        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600">
          <label className="flex items-center gap-1">
            <span>due</span>
            <input
              type="date"
              value={t.due_date ?? ''}
              onChange={(e) => onEdit({ due_date: e.target.value || null })}
              className={cx('!px-1 !py-0 text-[11px]', vencida(t) && 'text-rose-400')}
            />
          </label>
          {vencida(t) && <span className="text-rose-400">overdue</span>}
          {mostrarSprint && <span>from {t.sprint_name}</span>}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
        {onMover && (
          <Button size="sm" variant="ghost" onClick={onMover} title="Pull into this sprint">
            ← pull in
          </Button>
        )}
        <Button size="sm" variant="ghost" className="text-rose-400" onClick={onDelete}>
          ✕
        </Button>
      </div>
    </li>
  );
}

/**
 * Lista personal de administración y gestión del sprint. No son tareas del
 * equipo: no se estiman, no consumen capacidad y no salen en las métricas.
 */
export function SprintTodos({ sprintId }: { sprintId: string }) {
  const qc = useQueryClient();
  const [nuevo, setNuevo] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['todos', sprintId],
    queryFn: () => api.todos.forSprint(sprintId),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['todos'] });

  const crear = useMutation({
    mutationFn: (title: string) => api.todos.create(sprintId, { title }),
    onSuccess: () => {
      setNuevo('');
      refresh();
    },
  });
  const actualizar = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: any }) => api.todos.update(id, patch),
    onSuccess: refresh,
  });
  const borrar = useMutation({ mutationFn: api.todos.remove, onSuccess: refresh });

  if (isLoading) return <p className="text-sm text-slate-500">Loading…</p>;

  const own = data?.own ?? [];
  const otras = data?.pendingElsewhere ?? [];
  const pendientes = own.filter((t) => !t.done);
  const hechas = own.filter((t) => t.done);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <Card
        title="My management to-dos"
        actions={
          own.length > 0 ? (
            <span className="text-xs text-slate-500">
              {hechas.length} of {own.length} done
              {pendientes.filter(vencida).length > 0 && (
                <span className="ml-2 text-rose-400">
                  {pendientes.filter(vencida).length} overdue
                </span>
              )}
            </span>
          ) : null
        }
      >
        <ErrorBanner error={crear.error ?? actualizar.error ?? borrar.error} />

        <form
          onSubmit={(e) => {
            e.preventDefault();
            const v = nuevo.trim();
            if (v) crear.mutate(v);
          }}
          className="mb-3 flex gap-2"
        >
          <input
            value={nuevo}
            onChange={(e) => setNuevo(e.target.value)}
            placeholder="Prepare the demo, review next sprint capacity, talk to product…"
            className="flex-1"
          />
          <Button type="submit" variant="primary" disabled={!nuevo.trim() || crear.isPending}>
            Add
          </Button>
        </form>

        {own.length === 0 ? (
          <Empty>
            Nothing here yet. This is your list, not the team's: it does not count towards capacity or metrics.
          </Empty>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {pendientes.map((t) => (
                <Fila
                  key={t.id}
                  t={t}
                  onToggle={() => actualizar.mutate({ id: t.id, patch: { done: true } })}
                  onEdit={(patch) => actualizar.mutate({ id: t.id, patch })}
                  onDelete={() => borrar.mutate(t.id)}
                />
              ))}
            </ul>

            {hechas.length > 0 && (
              <details className="mt-3" open={pendientes.length === 0}>
                <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-300">
                  {hechas.length} done
                </summary>
                <ul className="mt-2 flex flex-col gap-2">
                  {hechas.map((t) => (
                    <Fila
                      key={t.id}
                      t={t}
                      onToggle={() => actualizar.mutate({ id: t.id, patch: { done: false } })}
                      onEdit={(patch) => actualizar.mutate({ id: t.id, patch })}
                      onDelete={() => borrar.mutate(t.id)}
                    />
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </Card>

      {otras.length > 0 && (
        <Card
          title="Pending from other sprints"
          actions={<span className="text-xs text-slate-500">{otras.length} still open</span>}
        >
          <ul className="flex flex-col gap-2">
            {otras.map((t) => (
              <Fila
                key={t.id}
                t={t}
                mostrarSprint
                onToggle={() => actualizar.mutate({ id: t.id, patch: { done: true } })}
                onEdit={(patch) => actualizar.mutate({ id: t.id, patch })}
                onDelete={() => borrar.mutate(t.id)}
                onMover={() => actualizar.mutate({ id: t.id, patch: { sprint_id: sprintId } })}
              />
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-600">
            Whatever you left half-done does not vanish when the sprint closes. «← pull in» moves it here.
          </p>
        </Card>
      )}
    </div>
  );
}
