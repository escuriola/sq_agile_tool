import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { statusMeta, trackMeta, typeMeta, TASK_STATUSES, TASK_TRACKS, type Task } from '../lib/types';
import { Badge, Button, Card, Empty, ErrorBanner, Modal, cx } from '../components/ui';
import { hoursToHm } from '../lib/format';
import { TaskForm } from '../components/TaskForm';
import { PlanningBar } from '../components/PlanningBar';
import { WorkloadByOwner } from '../components/WorkloadByOwner';
import { SprintMetrics } from '../components/SprintMetrics';
import { CapacityEditor } from '../components/CapacityEditor';
import { WorklogImport } from '../components/WorklogImport';
import { TicketImport } from '../components/TicketImport';
import { RetroActions } from '../components/RetroActions';
import { SprintTodos } from '../components/SprintTodos';
import { SprintReport } from '../components/SprintReport';

/** Minúsculas y sin acentos, para que "sofia" encuentre a "Sofía". */
const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

export default function SprintDetailPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: 'tasks' | 'metrics' | 'retro' | 'todos' =
    raw === 'metrics' ? 'metrics' : raw === 'retro' ? 'retro' : raw === 'todos' ? 'todos' : 'tasks';

  const [modalOpen, setModalOpen] = useState(false);
  const [capacityOpen, setCapacityOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [ticketOpen, setTicketOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [editing, setEditing] = useState<Task | undefined>();
  const [filterProject, setFilterProject] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterTrack, setFilterTrack] = useState('');
  const [filterOwner, setFilterOwner] = useState('');
  const [onlyBlocked, setOnlyBlocked] = useState(false);
  const [search, setSearch] = useState('');
  const [copiado, setCopiado] = useState<'ok' | 'error' | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const sprint = useQuery({ queryKey: ['sprint', id], queryFn: () => api.sprints.get(id) });
  const tasks = useQuery({ queryKey: ['tasks', id], queryFn: () => api.sprints.tasks(id) });
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects.list });
  const users = useQuery({ queryKey: ['users'], queryFn: api.users.list });
  const allSprints = useQuery({ queryKey: ['sprints'], queryFn: api.sprints.list });
  const capacities = useQuery({
    queryKey: ['capacities', id],
    queryFn: () => api.sprints.capacities(id),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['tasks', id] });
    qc.invalidateQueries({ queryKey: ['metrics', id] });
    qc.invalidateQueries({ queryKey: ['sprints'] });
    qc.invalidateQueries({ queryKey: ['velocity'] });
  };

  const save = useMutation({
    mutationFn: (payload: any) =>
      editing ? api.tasks.update(editing.uid, payload) : api.tasks.create(payload),
    onSuccess: () => {
      setModalOpen(false);
      setEditing(undefined);
      refresh();
    },
  });

  const quickStatus = useMutation({
    mutationFn: ({ uid, status }: { uid: string; status: string }) => api.tasks.update(uid, { status }),
    onSuccess: refresh,
  });

  const quickAssign = useMutation({
    mutationFn: ({ uid, assignee_id }: { uid: string; assignee_id: string | null }) =>
      api.tasks.update(uid, { assignee_id }),
    onSuccess: refresh,
  });

  const remove = useMutation({ mutationFn: api.tasks.remove, onSuccess: refresh });

  const allTasks = tasks.data ?? [];

  const userName = useMemo(
    () => new Map((users.data ?? []).map((u) => [u.id, u.name])),
    [users.data]
  );

  // Todos los términos deben aparecer en algún campo: "api 16" encuentra API-160.
  const terms = useMemo(
    () => normalize(search).split(/\s+/).filter(Boolean),
    [search]
  );

  const visible = useMemo(
    () =>
      allTasks.filter((t) => {
        if (filterProject && t.project_id !== filterProject) return false;
        if (filterStatus && t.status !== filterStatus) return false;
        if (filterTrack && t.track !== filterTrack) return false;
        if (onlyBlocked && !t.blocked) return false;
        if (filterOwner === '__none__' ? t.assignee_id : filterOwner && t.assignee_id !== filterOwner)
          return false;
        if (terms.length === 0) return true;
        const haystack = normalize(
          [t.key, t.title, t.comment, t.project_id, userName.get(t.assignee_id ?? '')]
            .filter(Boolean)
            .join(' ')
        );
        return terms.every((term) => haystack.includes(term));
      }),
    [allTasks, filterProject, filterStatus, filterTrack, filterOwner, onlyBlocked, terms, userName]
  );

  const projectColor = useMemo(
    () => new Map((projects.data ?? []).map((p) => [p.id, p.color ?? '#38bdf8'])),
    [projects.data]
  );

  // "/" enfoca el buscador, salvo si ya estás escribiendo en otro campo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /**
   * Copia las tareas visibles —las que quedan tras aplicar filtros y búsqueda—
   * como "ID: título", una por línea. Las que no tengan título salen sólo con
   * el id, que es más limpio que dejar los dos puntos colgando.
   */
  const copiarVisibles = async () => {
    const texto = visible
      .map((t) => (t.title?.trim() ? `${t.key}: ${t.title.trim()}` : t.key))
      .join('\n');
    // El método antiguo: funciona sin contexto seguro y sin foco del documento.
    const copiarConTextarea = () => {
      const ta = document.createElement('textarea');
      ta.value = texto;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    };

    try {
      // navigator.clipboard sólo existe en contexto seguro (localhost lo es) y
      // además falla si el documento no tiene el foco, así que hay que capturar
      // el rechazo y no sólo su ausencia.
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(texto);
        setCopiado('ok');
      } else {
        setCopiado(copiarConTextarea() ? 'ok' : 'error');
      }
    } catch {
      setCopiado(copiarConTextarea() ? 'ok' : 'error');
    }
    setTimeout(() => setCopiado(null), 2000);
  };

  const openNew = () => {
    setEditing(undefined);
    setModalOpen(true);
  };
  const openEdit = (t: Task) => {
    setEditing(t);
    setModalOpen(true);
  };

  if (sprint.isLoading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!sprint.data) return <Empty>Sprint «{id}» does not exist.</Empty>;

  const s = sprint.data;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <header className="flex flex-wrap items-center gap-3">
        <Link to="/sprints" className="text-sm text-slate-500 hover:text-slate-300">
          ← Sprints
        </Link>
        <h1 className="text-xl font-semibold text-slate-100">{s.name}</h1>
        <span className="text-xs text-slate-600">
          {s.start_date ?? '?'} → {s.end_date ?? '?'}
        </span>
        {s.goal && <span className="text-sm text-slate-500 italic">«{s.goal}»</span>}
        <Button size="sm" onClick={() => setReportOpen(true)} title="Sprint report with the points of attention">
          📋 Generate report
        </Button>
        <div className="ml-auto flex gap-1 rounded-lg border border-[var(--color-ink-800)] p-1">
          {([
            ['tasks', 'Tasks'],
            ['metrics', 'Metrics'],
            ['retro', 'Retro'],
            ['todos', 'My to-dos'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setParams(value === 'tasks' ? {} : { tab: value })}
              className={cx(
                'rounded-md px-3 py-1 text-sm transition',
                tab === value ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      {tab === 'tasks' ? (
        <>
          <PlanningBar
            tasks={allTasks}
            projects={projects.data ?? []}
            capacities={capacities.data ?? []}
            sprint={sprint.data}
            onEditCapacity={() => setCapacityOpen(true)}
          />

          <WorkloadByOwner
            tasks={allTasks}
            capacities={capacities.data ?? []}
            projects={projects.data ?? []}
            sprint={sprint.data}
            selectedOwner={filterOwner}
            onSelectOwner={setFilterOwner}
          />

          <Card
            title={`Tasks (${visible.length}${visible.length !== allTasks.length ? ` of ${allTasks.length}` : ''})`}
            actions={
              <div className="flex flex-wrap items-center justify-end gap-2">
                <div className="relative">
                  <input
                    ref={searchRef}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => e.key === 'Escape' && setSearch('')}
                    placeholder="Search tasks…   /"
                    className="w-56 pr-7 text-xs"
                    aria-label="Search tasks in the sprint"
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearch('');
                        searchRef.current?.focus();
                      }}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 px-1 text-slate-500 hover:text-slate-200"
                      aria-label="Clear search"
                    >
                      ✕
                    </button>
                  )}
                </div>
                <select value={filterProject} onChange={(e) => setFilterProject(e.target.value)} className="text-xs">
                  <option value="">All projects</option>
                  {(projects.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id}
                    </option>
                  ))}
                </select>
                <select value={filterTrack} onChange={(e) => setFilterTrack(e.target.value)} className="text-xs">
                  <option value="">Both tracks</option>
                  {TASK_TRACKS.map((tr) => (
                    <option key={tr.value} value={tr.value}>
                      {tr.label}
                    </option>
                  ))}
                </select>
                <select value={filterOwner} onChange={(e) => setFilterOwner(e.target.value)} className="text-xs">
                  <option value="">Any owner</option>
                  <option value="__none__">— unassigned —</option>
                  {(users.data ?? []).filter((u) => u.active).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
                <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="text-xs">
                  <option value="">All statuses</option>
                  {TASK_STATUSES.map((st) => (
                    <option key={st.value} value={st.value}>
                      {st.label}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant={onlyBlocked ? 'danger' : 'default'}
                  onClick={() => setOnlyBlocked((v) => !v)}
                  title="Show only blocked tasks"
                >
                  ⛔ {allTasks.filter((t) => t.blocked).length}
                </Button>
                <Button
                  size="sm"
                  variant={copiado === 'ok' ? 'primary' : copiado === 'error' ? 'danger' : 'default'}
                  onClick={copiarVisibles}
                  disabled={visible.length === 0}
                  title={`Copy the ${visible.length} visible tasks to the clipboard as «ID: title»`}
                  aria-label="Copy visible tasks to the clipboard"
                >
                  {copiado === 'ok' ? '✓ copied' : copiado === 'error' ? '✕ error' : '⧉'}
                </Button>
                <Button size="sm" onClick={() => setImportOpen(true)}>
                  Import worklog
                </Button>
                <Button size="sm" onClick={() => setTicketOpen(true)}>
                  Import issues
                </Button>
                <Button variant="primary" size="sm" onClick={openNew}>
                  + New task
                </Button>
              </div>
            }
          >
            <ErrorBanner error={remove.error ?? quickStatus.error ?? quickAssign.error} />
            {visible.length === 0 ? (
              allTasks.length === 0 ? (
                <Empty>No tasks yet. Start by adding one.</Empty>
              ) : (
                <Empty>
                  No task matches{search && <> «{search}»</>}.{' '}
                  <button
                    onClick={() => {
                      setSearch('');
                      setFilterProject('');
                      setFilterStatus('');
                      setFilterTrack('');
                      setFilterOwner('');
                      setOnlyBlocked(false);
                    }}
                    className="text-sky-400 hover:text-sky-300"
                  >
                    Quitar filtros
                  </button>
                </Empty>
              )
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                      <th className="pb-2 pr-3">Task</th>
                      <th className="pb-2 pr-3">Proj.</th>
                      <th className="pb-2 pr-3">Track</th>
                      <th className="pb-2 pr-3">Type</th>
                      <th className="pb-2 pr-3">Status</th>
                      <th className="pb-2 pr-3">Owner</th>
                      <th className="pb-2 pr-3 text-right">Pts</th>
                      <th className="pb-2 pr-3 text-right">Est. h</th>
                      <th className="pb-2 pr-3 text-right">Actual h</th>
                      <th className="pb-2 pr-3">Logged</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-ink-800)]">
                    {visible.map((t) => {
                      const sm = statusMeta(t.status);
                      const tm = typeMeta(t.type);
                      const over = t.estimate_hours != null && t.logged_hours > t.estimate_hours;
                      return (
                        <tr key={t.uid} className="align-top hover:bg-[var(--color-ink-850)]/40">
                          <td className="py-2 pr-3">
                            <button onClick={() => openEdit(t)} className="text-left">
                              <span className="font-mono text-xs text-sky-400 hover:text-sky-300">{t.key}</span>
                              {t.added_after_start && (
                                <span className="ml-1.5 text-[10px] text-amber-500" title="Added after the sprint started">
                                  ⊕
                                </span>
                              )}
                              {t.blocked && (
                                <span className="ml-1.5 text-[10px] text-rose-400" title="Blocked">
                                  ⛔
                                </span>
                              )}
                              {t.title && <div className="text-xs text-slate-400">{t.title}</div>}
                              {t.comment && (
                                <div className="mt-0.5 max-w-md truncate text-[11px] text-slate-600">{t.comment}</div>
                              )}
                            </button>
                          </td>
                          <td className="py-2 pr-3">
                            <span
                              className="font-mono text-xs"
                              style={{ color: projectColor.get(t.project_id) ?? '#94a3b8' }}
                            >
                              {t.project_id}
                            </span>
                          </td>
                          <td className="py-2 pr-3">
                            <Badge color={trackMeta(t.track).color}>{trackMeta(t.track).label}</Badge>
                          </td>
                          <td className="py-2 pr-3">
                            <Badge color={tm.color}>{tm.label}</Badge>
                          </td>
                          <td className="py-2 pr-3">
                            <select
                              value={t.status}
                              onChange={(e) => quickStatus.mutate({ uid: t.uid, status: e.target.value })}
                              className="text-xs"
                              style={{ color: sm.color }}
                            >
                              {TASK_STATUSES.map((st) => (
                                <option key={st.value} value={st.value}>
                                  {st.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2 pr-3">
                            <select
                              value={t.assignee_id ?? ''}
                              onChange={(e) =>
                                quickAssign.mutate({ uid: t.uid, assignee_id: e.target.value || null })
                              }
                              className={cx('text-xs', !t.assignee_id && 'text-slate-600')}
                            >
                              <option value="">— unassigned —</option>
                              {(users.data ?? [])
                                .filter((u) => u.active || u.id === t.assignee_id)
                                .map((u) => (
                                  <option key={u.id} value={u.id}>
                                    {u.name}
                                  </option>
                                ))}
                            </select>
                          </td>
                          <td className="py-2 pr-3 text-right text-slate-300">{t.estimate_points ?? '—'}</td>
                          <td className="py-2 pr-3 text-right text-slate-400">{t.estimate_hours ?? '—'}</td>
                          <td
                            className={cx(
                              'py-2 pr-3 text-right font-medium',
                              over ? 'text-rose-400' : 'text-slate-200'
                            )}
                          >
                            <span title={t.logged_hours ? hoursToHm(Number(t.logged_hours)) : undefined}>
                              {t.logged_hours ? +Number(t.logged_hours).toFixed(4) : '—'}
                            </span>
                          </td>
                          <td className="py-2 pr-3">
                            {t.dedications.length === 0 ? (
                              <span className="text-xs text-slate-700">—</span>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {t.dedications.map((d) => (
                                  <span
                                    key={d.id}
                                    title={`${d.date} · ${Number(d.hours)} h${d.note ? ` · ${d.note}` : ''}`}
                                    className="rounded bg-[var(--color-ink-800)] px-1.5 py-0.5 text-[11px] text-slate-400"
                                  >
                                    {userName.get(d.user_id) ?? d.user_id}{' '}
                                    <span className="text-slate-200">{hoursToHm(Number(d.hours))}</span>
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="py-2 text-right">
                            <div className="flex justify-end gap-1">
                              <Button size="sm" variant="ghost" onClick={() => openEdit(t)}>
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-rose-400"
                                onClick={() => confirm(`Delete ${t.key}?`) && remove.mutate(t.uid)}
                              >
                                ✕
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      ) : tab === 'metrics' ? (
        <SprintMetrics
          sprintId={id}
          projects={projects.data ?? []}
          onEditCapacity={() => setCapacityOpen(true)}
        />
      ) : tab === 'retro' ? (
        <RetroActions sprintId={id} users={users.data ?? []} />
      ) : (
        <SprintTodos sprintId={id} />
      )}

      <TicketImport sprintId={id} open={ticketOpen} onClose={() => setTicketOpen(false)} />

      <SprintReport sprintId={id} open={reportOpen} onClose={() => setReportOpen(false)} />

      <CapacityEditor
        sprintId={id}
        sprints={allSprints.data ?? []}
        open={capacityOpen}
        onClose={() => setCapacityOpen(false)}
      />

      <WorklogImport
        sprintId={id}
        users={users.data ?? []}
        open={importOpen}
        onClose={() => setImportOpen(false)}
      />

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        wide
        title={editing ? `Edit ${editing.key}` : 'New task'}
      >
        <TaskForm
          key={editing?.uid ?? 'new'}
          task={editing}
          sprintId={id}
          projects={projects.data ?? []}
          users={users.data ?? []}
          defaultProject={filterProject || undefined}
          onSubmit={(p) => save.mutate(p)}
          onCancel={() => setModalOpen(false)}
          submitting={save.isPending}
          error={save.error}
        />
      </Modal>
    </div>
  );
}
