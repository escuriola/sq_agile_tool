import { useMemo, useState } from 'react';
import { Button, ErrorBanner, Field, cx } from './ui';
import { hoursToHm } from '../lib/format';
import {
  TASK_STATUSES,
  TASK_TRACKS,
  TASK_TYPES,
  type Project,
  type Task,
  type TaskStatus,
  type TaskTrack,
  type TaskType,
  type User,
} from '../lib/types';

/** `id` sólo lo tienen las que ya existen; conservarlo preserva su origen al guardar. */
type DedDraft = { id?: string; user_id: string; hours: string; date: string; note: string };

const today = () => new Date().toISOString().slice(0, 10);
const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));

export function TaskForm({
  task,
  sprintId,
  projects,
  users,
  defaultProject,
  onSubmit,
  onCancel,
  submitting,
  error,
}: {
  task?: Task;
  sprintId: string;
  projects: Project[];
  users: User[];
  defaultProject?: string;
  onSubmit: (payload: any) => void;
  onCancel: () => void;
  submitting?: boolean;
  error?: unknown;
}) {
  const [key, setKey] = useState(task?.key ?? '');
  const [projectId, setProjectId] = useState(task?.project_id ?? defaultProject ?? projects[0]?.id ?? '');
  const [title, setTitle] = useState(task?.title ?? '');
  const [type, setType] = useState<TaskType>(task?.type ?? 'story');
  const [track, setTrack] = useState<TaskTrack>(task?.track ?? 'delivery');
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? 'todo');
  const [points, setPoints] = useState(task?.estimate_points?.toString() ?? '');
  const [hours, setHours] = useState(task?.estimate_hours?.toString() ?? '');
  const [assignee, setAssignee] = useState(task?.assignee_id ?? '');
  const [comment, setComment] = useState(task?.comment ?? '');
  const [addedAfter, setAddedAfter] = useState(task?.added_after_start ?? false);
  const [blocked, setBlocked] = useState(task?.blocked ?? false);
  const [completedAt, setCompletedAt] = useState(task?.completed_at ?? '');
  const [localError, setLocalError] = useState<string | null>(null);

  const [deds, setDeds] = useState<DedDraft[]>(
    task?.dedications.map((d) => ({
      id: d.id,
      user_id: d.user_id,
      hours: String(d.hours),
      date: d.date,
      note: d.note ?? '',
    })) ?? []
  );

  const activeUsers = useMemo(() => users.filter((u) => u.active), [users]);
  const totalLogged = deds.reduce((a, d) => a + (Number(d.hours) || 0), 0);

  const addDed = () =>
    setDeds((prev) => [
      ...prev,
      { user_id: activeUsers[0]?.id ?? '', hours: '', date: today(), note: '' },
    ]);

  const patchDed = (i: number, patch: Partial<DedDraft>) =>
    setDeds((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));

  const removeDed = (i: number) => setDeds((prev) => prev.filter((_, idx) => idx !== i));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (!key.trim()) return setLocalError('The task id is required.');
    if (!projectId) return setLocalError('Pick a project.');

    const cleanDeds = deds.filter((d) => d.user_id && Number(d.hours) > 0);
    if (cleanDeds.length !== deds.length && deds.some((d) => d.hours.trim() !== '' || d.user_id)) {
      const bad = deds.find((d) => !d.user_id || !(Number(d.hours) > 0));
      if (bad) return setLocalError('Every logged entry needs a person and hours greater than 0.');
    }

    onSubmit({
      key: key.trim(),
      sprint_id: sprintId,
      project_id: projectId,
      title: title.trim() || null,
      type,
      track,
      status,
      estimate_points: numOrNull(points),
      estimate_hours: numOrNull(hours),
      assignee_id: assignee || null,
      comment: comment.trim() || null,
      added_after_start: addedAfter,
      blocked,
      // La fecha de cierre alimenta el burndown: si registras a posteriori, ponla a mano.
      completed_at: status === 'done' ? completedAt || today() : null,
      dedications: cleanDeds.map((d) => ({
        id: d.id,
        user_id: d.user_id,
        hours: Number(d.hours),
        date: d.date,
        note: d.note.trim() || null,
      })),
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <ErrorBanner error={localError ?? error} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Task id *" hint="e.g. EMA-1420">
          <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="EMA-1420" autoFocus />
        </Field>
        <Field label="Project *">
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Type">
          <select value={type} onChange={(e) => setType(e.target.value as TaskType)}>
            {TASK_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Track" hint="delivery is the commitment; discovery consumes its reserved share">
        <div className="flex gap-2">
          {TASK_TRACKS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTrack(t.value)}
              className={cx(
                'flex-1 rounded-md border px-3 py-2 text-sm font-medium transition',
                track === t.value
                  ? 'text-slate-900'
                  : 'border-[var(--color-ink-700)] text-slate-400 hover:text-slate-200'
              )}
              style={
                track === t.value
                  ? { backgroundColor: t.color, borderColor: t.color }
                  : undefined
              }
            >
              {t.label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Title (optional)">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short description" />
      </Field>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Estimate (points)">
          <input
            type="number"
            step="any"
            min="0"
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            placeholder="5"
          />
        </Field>
        <Field label="Estimate (hours)">
          <input
            type="number"
            step="any"
            min="0"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="8"
          />
        </Field>
        <Field label="Status">
          <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
            {TASK_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Owner">
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">— unassigned —</option>
            {activeUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {status === 'done' && (
        <Field label="Completion date" hint="feeds the burndown; today if left empty">
          <input
            type="date"
            className="max-w-48"
            value={completedAt}
            onChange={(e) => setCompletedAt(e.target.value)}
          />
        </Field>
      )}

      <Field label="Comment">
        <textarea
          rows={2}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Context, blockers, decisions…"
        />
      </Field>

      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm text-slate-400">
          <input
            type="checkbox"
            className="size-4 accent-sky-500"
            checked={addedAfter}
            onChange={(e) => setAddedAfter(e.target.checked)}
          />
          Added after the sprint started (counts as scope change)
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-400">
          <input
            type="checkbox"
            className="size-4 accent-rose-500"
            checked={blocked}
            onChange={(e) => setBlocked(e.target.checked)}
          />
          Blocked
          <span className="text-xs text-slate-600">— keeps its place in the flow</span>
        </label>
      </div>

      {/* ------------------------------------------------------- dedicaciones */}
      <div className="rounded-lg border border-[var(--color-ink-700)] bg-[var(--color-ink-900)]/60 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Time logged · {+totalLogged.toFixed(4)} h
            {totalLogged > 0 && (
              <span className="ml-1 normal-case text-slate-600">({hoursToHm(totalLogged)})</span>
            )}
          </div>
          <Button type="button" size="sm" onClick={addDed} disabled={activeUsers.length === 0}>
            + Add entry
          </Button>
        </div>

        {activeUsers.length === 0 && (
          <p className="text-xs text-amber-500">Create users before logging time.</p>
        )}

        {deds.length === 0 && activeUsers.length > 0 && (
          <p className="text-xs text-slate-600">No time logged yet.</p>
        )}

        <div className="flex flex-col gap-2">
          {deds.map((d, i) => (
            <div key={i} className="grid grid-cols-12 items-center gap-2">
              <select
                className="col-span-4"
                value={d.user_id}
                onChange={(e) => patchDed(i, { user_id: e.target.value })}
              >
                <option value="">— person —</option>
                {activeUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
              <div className="col-span-2 flex flex-col">
                <input
                  type="number"
                  step="any"
                  min="0"
                  placeholder="h"
                  value={d.hours}
                  onChange={(e) => patchDed(i, { hours: e.target.value })}
                />
                {Number(d.hours) > 0 && (
                  <span className="mt-0.5 text-center text-[10px] text-slate-600">
                    {hoursToHm(Number(d.hours))}
                  </span>
                )}
              </div>
              <input
                className="col-span-3"
                type="date"
                value={d.date}
                onChange={(e) => patchDed(i, { date: e.target.value })}
              />
              <input
                className="col-span-2"
                placeholder="note"
                value={d.note}
                onChange={(e) => patchDed(i, { note: e.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="col-span-1"
                onClick={() => removeDed(i)}
                aria-label="Remove"
              >
                ✕
              </Button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? 'Saving…' : task ? 'Save changes' : 'Create task'}
        </Button>
      </div>
    </form>
  );
}
