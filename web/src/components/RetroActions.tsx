import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { RETRO_STATUSES, retroMeta, type RetroAction, type User } from '../lib/types';
import { Badge, Button, Card, Empty, ErrorBanner, Field, Modal, cx } from './ui';

const today = () => new Date().toISOString().slice(0, 10);
const isOverdue = (a: RetroAction) =>
  !!a.due_date && a.due_date < today() && (a.status === 'pending' || a.status === 'in_progress');

/** Formulario SMART. Cada campo es una letra del acrónimo, dicho en cristiano. */
function ActionForm({
  action,
  users,
  onSubmit,
  onCancel,
  submitting,
  error,
}: {
  action?: RetroAction;
  users: User[];
  onSubmit: (b: any) => void;
  onCancel: () => void;
  submitting?: boolean;
  error?: unknown;
}) {
  const [title, setTitle] = useState(action?.title ?? '');
  const [measurable, setMeasurable] = useState(action?.measurable ?? '');
  const [achievable, setAchievable] = useState(action?.achievable ?? '');
  const [relevant, setRelevant] = useState(action?.relevant ?? '');
  const [dueDate, setDueDate] = useState(action?.due_date ?? '');
  const [ownerId, setOwnerId] = useState(action?.owner_id ?? '');
  const [status, setStatus] = useState(action?.status ?? 'pending');
  const [outcome, setOutcome] = useState(action?.outcome ?? '');
  const [err, setErr] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setErr('Say what will be done.');
    setErr(null);
    onSubmit({
      title: title.trim(),
      measurable: measurable.trim() || null,
      achievable: achievable.trim() || null,
      relevant: relevant.trim() || null,
      due_date: dueDate || null,
      owner_id: ownerId || null,
      status,
      outcome: outcome.trim() || null,
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <ErrorBanner error={err ?? error} />

      <Field label="S · What will be done *" hint="a concrete action, not a good intention">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Review the estimates of DARWIN tasks before planning"
          autoFocus
        />
      </Field>

      <Field label="M · How we will know it is done" hint="something checkable">
        <input
          value={measurable}
          onChange={(e) => setMeasurable(e.target.value)}
          placeholder="No DARWIN task enters the sprint without an estimate in hours"
        />
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="A · Why it is achievable">
          <input
            value={achievable}
            onChange={(e) => setAchievable(e.target.value)}
            placeholder="It is 30 min in refinement"
          />
        </Field>
        <Field label="R · What problem it solves">
          <input
            value={relevant}
            onChange={(e) => setRelevant(e.target.value)}
            placeholder="Last sprint we overshot by 20% due to bad estimates"
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="T · Due date">
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <Field label="Owner">
          <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
            <option value="">— unassigned —</option>
            {users.filter((u) => u.active).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select value={status} onChange={(e) => setStatus(e.target.value as any)}>
            {RETRO_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {(status === 'done' || status === 'dropped') && (
        <Field label="What actually happened" hint="what you report when reviewing it next retro">
          <textarea rows={2} value={outcome} onChange={(e) => setOutcome(e.target.value)} />
        </Field>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={submitting}>
          {action ? 'Save' : 'Create action'}
        </Button>
      </div>
    </form>
  );
}

function ActionRow({
  a,
  showSprint,
  users,
  onEdit,
  onStatus,
  onDelete,
}: {
  a: RetroAction;
  showSprint?: boolean;
  users: User[];
  onEdit: () => void;
  onStatus: (s: string) => void;
  onDelete: () => void;
}) {
  const meta = retroMeta(a.status);
  const overdue = isOverdue(a);
  const smart = [a.measurable, a.achievable, a.relevant, a.due_date].filter(Boolean).length;

  return (
    <li className="flex flex-col gap-1.5 rounded-lg border border-[var(--color-ink-800)] bg-[var(--color-ink-850)]/40 px-3 py-2.5">
      <div className="flex flex-wrap items-start gap-2">
        <button onClick={onEdit} className="flex-1 text-left text-sm text-slate-200 hover:text-sky-300">
          {a.title}
        </button>
        <Badge color={meta.color}>{meta.label}</Badge>
        {overdue && <Badge color="#f43f5e">overdue</Badge>}
        {smart < 4 && (
          <span
            className="text-[11px] text-amber-500/70"
            title="Missing SMART fields: measurable, achievable, relevant or due date"
          >
            {smart}/4 SMART
          </span>
        )}
      </div>

      {a.measurable && (
        <div className="text-xs text-slate-500">
          <span className="text-slate-600">Measured by: </span>
          {a.measurable}
        </div>
      )}
      {a.outcome && (
        <div className="text-xs text-slate-500">
          <span className="text-slate-600">Outcome: </span>
          {a.outcome}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
        {a.owner_name ? <span>{a.owner_name}</span> : <span className="text-amber-500/70">no owner</span>}
        {a.due_date ? (
          <span className={cx(overdue && 'text-rose-400')}>due {a.due_date}</span>
        ) : (
          <span className="text-amber-500/70">no due date</span>
        )}
        {showSprint && <span>from {a.sprint_name}</span>}
        <div className="ml-auto flex items-center gap-1">
          <select
            value={a.status}
            onChange={(e) => onStatus(e.target.value)}
            className="text-[11px]"
            style={{ color: meta.color }}
          >
            {RETRO_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <Button size="sm" variant="ghost" onClick={onEdit}>
            Edit
          </Button>
          <Button size="sm" variant="ghost" className="text-rose-400" onClick={onDelete}>
            ✕
          </Button>
        </div>
      </div>
    </li>
  );
}

export function RetroActions({ sprintId, users }: { sprintId: string; users: User[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RetroAction | undefined>();

  const { data, isLoading } = useQuery({
    queryKey: ['retro', sprintId],
    queryFn: () => api.retro.forSprint(sprintId),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['retro'] });

  const save = useMutation({
    mutationFn: (b: any) =>
      editing ? api.retro.update(editing.id, b) : api.retro.create(sprintId, b),
    onSuccess: () => {
      setOpen(false);
      setEditing(undefined);
      refresh();
    },
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.retro.update(id, { status } as any),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: api.retro.remove, onSuccess: refresh });

  if (isLoading) return <p className="text-sm text-slate-500">Loading…</p>;

  const own = data?.own ?? [];
  const carried = data?.carriedOver ?? [];
  const openCount = own.filter((a) => a.status === 'pending' || a.status === 'in_progress').length;
  const doneCount = own.filter((a) => a.status === 'done').length;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      {/* Lo primero de una retro es rendir cuentas de la anterior. */}
      {carried.length > 0 && (
        <Card
          title="Carried over from earlier retros"
          actions={
            <span className="text-xs text-amber-500">
              {carried.filter(isOverdue).length > 0 &&
                `${carried.filter(isOverdue).length} overdue · `}
              {carried.length} still open
            </span>
          }
        >
          <ul className="flex flex-col gap-2">
            {carried.map((a) => (
              <ActionRow
                key={a.id}
                a={a}
                showSprint
                users={users}
                onEdit={() => {
                  setEditing(a);
                  setOpen(true);
                }}
                onStatus={(s) => setStatus.mutate({ id: a.id, status: s })}
                onDelete={() => confirm(`Delete «${a.title}»?`) && remove.mutate(a.id)}
              />
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-600">
            Review these before adding new ones: a retro that only creates commitments and never closes
            them stops being taken seriously.
          </p>
        </Card>
      )}

      <Card
        title={`Actions from this retro (${own.length})`}
        actions={
          <div className="flex items-center gap-3">
            {own.length > 0 && (
              <span className="text-xs text-slate-500">
                {doneCount} done · {openCount} open
              </span>
            )}
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setEditing(undefined);
                setOpen(true);
              }}
            >
              + New action
            </Button>
          </div>
        }
      >
        <ErrorBanner error={remove.error ?? setStatus.error} />
        {own.length === 0 ? (
          <Empty>
            No actions yet. A good retro produces two or three, not ten.
          </Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {own.map((a) => (
              <ActionRow
                key={a.id}
                a={a}
                users={users}
                onEdit={() => {
                  setEditing(a);
                  setOpen(true);
                }}
                onStatus={(s) => setStatus.mutate({ id: a.id, status: s })}
                onDelete={() => confirm(`Delete «${a.title}»?`) && remove.mutate(a.id)}
              />
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        wide
        title={editing ? 'Edit action' : 'New SMART action'}
      >
        <ActionForm
          key={editing?.id ?? 'new'}
          action={editing}
          users={users}
          onSubmit={(b) => save.mutate(b)}
          onCancel={() => setOpen(false)}
          submitting={save.isPending}
          error={save.error}
        />
      </Modal>
    </div>
  );
}
