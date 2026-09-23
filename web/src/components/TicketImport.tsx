import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { parseCsv, type Csv } from '../lib/csv';
import { Badge, Button, Empty, ErrorBanner, Modal, cx } from './ui';
import { TASK_STATUSES } from '../lib/types';

const MESES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** "07/Sep/26 1:23 PM" -> "2026-09-07" */
function fechaJira(v: string): string | null {
  const m = (v ?? '').match(/^(\d{1,2})\/([A-Za-z]{3})\/(\d{2,4})/);
  if (!m) return null;
  const mes = MESES[m[2].toLowerCase()];
  if (!mes) return null;
  let y = +m[3];
  if (y < 100) y += 2000;
  return `${y}-${String(mes).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`;
}

const horas = (v: string) => {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : Math.round((n / 3600) * 10000) / 10000;
};

/**
 * Importa el export de incidencias de Jira. A diferencia del worklog, aquí los
 * nombres de columna son fijos, así que no hace falta mapear nada a mano.
 */
export function TicketImport({
  sprintId,
  open,
  onClose,
}: {
  sprintId: string;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  // Varios ficheros a la vez: un export por proyecto, todos del mismo sprint.
  const [files, setFiles] = useState<{ name: string; csv: Csv }[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [applyBlocked, setApplyBlocked] = useState(true);
  const [applyTrack, setApplyTrack] = useState(true);
  const [applyType, setApplyType] = useState(true);
  const [applyStatus, setApplyStatus] = useState(true);
  const [createMissing, setCreateMissing] = useState(true);
  const [estOverrides, setEstOverrides] = useState<Record<string, string>>({});
  const [projDraft, setProjDraft] = useState<Record<string, string>>({});
  const [mapDraft, setMapDraft] = useState<Record<string, string>>({});

  const saved = useQuery({ queryKey: ['statusMap'], queryFn: api.statusMap.list });
  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: api.projects.list });

  const reset = () => {
    setFiles([]);
    setParseError(null);
    setPreview(null);
    setEstOverrides({});
    setProjDraft({});
  };

  const addFiles = (list: FileList) => {
    Promise.all(
      [...list].map(async (f) => ({ name: f.name, text: await f.text() }))
    ).then((read) => {
      try {
        const parsed = read.map((r) => ({ name: r.name, csv: parseCsv(r.text) }));
        const sinKey = parsed.filter((p) => !p.csv.headers.includes('Issue key'));
        if (sinKey.length) {
          setParseError(
            `These files do not look like the issues export (no «Issue key» column): ${sinKey
              .map((p) => p.name)
              .join(', ')}`
          );
          return;
        }
        // se acumulan, para poder soltar los proyectos de uno en uno
        setFiles((prev) => [...prev, ...parsed.filter((p) => !prev.some((x) => x.name === p.name))]);
        setParseError(null);
        setPreview(null);
      } catch (e) {
        setParseError((e as Error).message);
      }
    });
  };

  const rows = useMemo(() => {
    // Las columnas se resuelven por NOMBRE en cada fichero, no por posición: dos
    // exports de proyectos distintos pueden traer el mismo juego en otro orden.
    const out: any[] = [];
    for (const { csv } of files) {
    const cols = (name: string) =>
      csv.headers.map((h, i) => (h.trim() === name ? i : -1)).filter((i) => i >= 0);
    const one = (r: string[], name: string) => {
      for (const i of cols(name)) {
        const v = (r[i] ?? '').trim();
        if (v) return v;
      }
      return '';
    };
    const many = (r: string[], name: string) =>
      cols(name).map((i) => (r[i] ?? '').trim()).filter(Boolean);

    out.push(...csv.rows
      .filter((r) => one(r, 'Issue key'))
      .map((r) => ({
        key: one(r, 'Issue key'),
        summary: one(r, 'Summary') || null,
        issue_type: one(r, 'Issue Type') || null,
        jira_status: one(r, 'Status') || null,
        priority: one(r, 'Priority') || null,
        component: one(r, 'Component/s') || null,
        epic: one(r, 'Custom field (Epic Link)') || null,
        labels: many(r, 'Labels'),
        blocked_by: many(r, 'Inward issue link (Blocking)'),
        sprints: many(r, 'Sprint'),
        jira_created_at: fechaJira(one(r, 'Created')),
        jira_resolved_at: fechaJira(one(r, 'Resolved')),
        flagged: one(r, 'Custom field (Flagged)') || null,
        total_time_spent: horas(one(r, 'Σ Time Spent')),
        project_key: one(r, 'Project key') || null,
        original_estimate: horas(one(r, 'Original Estimate')),
      })));
    }
    // si el mismo ticket aparece en dos ficheros, gana la primera aparición
    const seen = new Set<string>();
    return out.filter((r) => (seen.has(r.key) ? false : (seen.add(r.key), true)));
  }, [files]);

  // Estados de Jira presentes en el fichero, para configurar sólo lo que hace falta.
  const jiraStatuses = useMemo(
    () => [...new Set(rows.map((r) => r.jira_status).filter(Boolean) as string[])].sort(),
    [rows]
  );

  const effectiveMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of saved.data ?? []) m[s.jira_status] = s.app_status;
    return { ...m, ...mapDraft };
  }, [saved.data, mapDraft]);

  const sinMapear = jiraStatuses.filter((s) => !effectiveMap[s]);

  const saveMap = useMutation({
    mutationFn: () =>
      api.statusMap.save(
        jiraStatuses.map((s) => ({ jira_status: s, app_status: effectiveMap[s] ?? '' }))
      ),
    onSuccess: () => {
      setMapDraft({});
      qc.invalidateQueries({ queryKey: ['statusMap'] });
    },
  });

  const run = useMutation({
    mutationFn: async (dry: boolean) => {
      // La equivalencia de proyectos se guarda antes de crear nada: si no, la
      // siguiente importación volvería a preguntar lo mismo.
      const pm = Object.entries(projDraft).filter(([, v]) => v);
      if (!dry && pm.length) {
        await api.projectMap.save(pm.map(([jira_project, project_id]) => ({ jira_project, project_id })));
      }
      return api.sprints.importTickets(sprintId, {
        dry_run: dry,
        rows,
        apply_blocked: applyBlocked,
        apply_track: applyTrack,
        apply_type: applyType,
        apply_status: applyStatus,
        create_missing: createMissing,
        estimate_overrides: Object.fromEntries(
          Object.entries(estOverrides)
            .filter(([, v]) => v.trim() !== '' && Number(v) >= 0)
            .map(([k, v]) => [k, Number(v)])
        ),
      });
    },
    onSuccess: (res) => {
      setPreview(res);
      if (!res.dry_run) {
        qc.invalidateQueries({ queryKey: ['tasks', sprintId] });
        qc.invalidateQueries({ queryKey: ['metrics', sprintId] });
        qc.invalidateQueries({ queryKey: ['report', sprintId] });
      }
    },
  });

  const done = preview && !preview.dry_run;

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      wide
      title="Import Jira issues"
    >
      <div className="flex flex-col gap-4">
        <ErrorBanner error={parseError ?? run.error} />

        {files.length === 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-slate-500">
              This is the <strong className="text-slate-300">issues</strong> export (one row per
              ticket), not the worklog one. It carries the parent task's real status, priority,
              component, epic, the blocked flag, blocking links and how many sprints the task has
              lived in. You can drop <strong className="text-slate-300">several files at once</strong>,
              one per project.
            </p>
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-[var(--color-ink-700)] px-4 py-8 text-sm text-slate-500 hover:border-sky-600 hover:text-slate-300">
              <span className="text-2xl">🎫</span>
              <span>Choose CSV files</span>
              <input
                type="file"
                accept=".csv,text/csv,text/plain"
                multiple
                className="hidden"
                onChange={(e) => e.target.files && addFiles(e.target.files)}
              />
            </label>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {files.map((f) => (
                <span
                  key={f.name}
                  className="flex items-center gap-1.5 rounded-md border border-[var(--color-ink-700)] bg-[var(--color-ink-900)]/60 px-2 py-1"
                >
                  <span className="text-slate-300">{f.name}</span>
                  <span className="text-slate-600">{f.csv.rows.length} rows</span>
                  <button
                    onClick={() => {
                      setFiles((p) => p.filter((x) => x.name !== f.name));
                      setPreview(null);
                    }}
                    className="text-slate-600 hover:text-rose-400"
                    aria-label={`Remove ${f.name}`}
                  >
                    ✕
                  </button>
                </span>
              ))}
              <label className="cursor-pointer rounded-md border border-dashed border-[var(--color-ink-700)] px-2 py-1 text-slate-500 hover:border-sky-600 hover:text-slate-300">
                + add file
                <input
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  multiple
                  className="hidden"
                  onChange={(e) => e.target.files && addFiles(e.target.files)}
                />
              </label>
              <span className="text-slate-500">{rows.length} issues in total</span>
              <Button size="sm" variant="ghost" onClick={reset}>
                Clear
              </Button>
            </div>

            <div className="flex flex-wrap gap-4 rounded-lg border border-[var(--color-ink-700)] bg-[var(--color-ink-900)]/60 p-3">
              {[
                ['Mark blocked from the Jira flag', applyBlocked, setApplyBlocked],
                ['Set the track from delivery/discovery labels', applyTrack, setApplyTrack],
                ['Translate the issue type', applyType, setApplyType],
                ['Move tasks to the mapped status', applyStatus, setApplyStatus],
                ['Create tasks that are not in the sprint yet', createMissing, setCreateMissing],
              ].map(([label, val, set]: any) => (
                <label key={label} className="flex items-center gap-2 text-xs text-slate-400">
                  <input
                    type="checkbox"
                    className="size-4 accent-sky-500"
                    checked={val}
                    onChange={(e) => set(e.target.checked)}
                  />
                  {label}
                </label>
              ))}
            </div>

            {/* ------------------- tareas nuevas: proyecto y estimación pendientes */}
            {createMissing && preview?.toCreate?.length > 0 && !done && (
              <div className="rounded-lg border border-[var(--color-ink-700)] bg-[var(--color-ink-900)]/60 p-3">
                <h4 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  {preview.toCreate.length} tasks would be created
                </h4>
                <p className="mb-2 text-xs text-slate-600">
                  The DEV subtask estimate is not in this export, so the task's own estimate is used.
                  Where there is none, type it here: a task without an estimate would be left out of
                  the burndown and the deviation, so it is not created until it has one.
                </p>
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-slate-500">
                        <th className="pb-1">Task</th>
                        <th className="pb-1">Project</th>
                        <th className="pb-1">Status</th>
                        <th className="pb-1 text-right">Estimate (h)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-ink-800)]">
                      {preview.toCreate.map((c: any) => (
                        <tr key={c.key}>
                          <td className="py-1">
                            <span className="font-mono text-slate-300">{c.key}</span>
                            {c.title && (
                              <div className="max-w-64 truncate text-[11px] text-slate-600">{c.title}</div>
                            )}
                          </td>
                          <td className="py-1">
                            <select
                              className="text-[11px]"
                              value={projDraft[c.jira_project] ?? c.project_id ?? ''}
                              onChange={(e) =>
                                setProjDraft((d) => ({ ...d, [c.jira_project]: e.target.value }))
                              }
                            >
                              <option value="">— pick —</option>
                              {projects.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.id}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-1 text-slate-500">{c.jira_status}</td>
                          <td className="py-1 text-right">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              className="w-20 text-right text-[11px]"
                              placeholder={c.estimate_hours != null ? String(c.estimate_hours) : 'needed'}
                              value={estOverrides[c.key] ?? ''}
                              onChange={(e) =>
                                setEstOverrides((d) => ({ ...d, [c.key]: e.target.value }))
                              }
                            />
                            {c.needsEstimate && !estOverrides[c.key]?.trim() && (
                              <div className="text-[10px] text-amber-500">required</div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {(preview.needProject?.length > 0 || preview.needEstimate?.length > 0) && (
                  <p className="mt-2 text-xs text-amber-500">
                    Tasks still missing a project or an estimate are skipped, the rest are created.
                  </p>
                )}
              </div>
            )}

            {/* --------------------------------- equivalencia de estados */}
            {jiraStatuses.length > 0 && (
              <div className="rounded-lg border border-[var(--color-ink-700)] bg-[var(--color-ink-900)]/60 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Status mapping · saved and reused on every import
                  </h4>
                  <Button
                    size="sm"
                    onClick={() => saveMap.mutate()}
                    disabled={saveMap.isPending || !Object.keys(mapDraft).length}
                  >
                    {saveMap.isPending ? 'Saving…' : 'Save mapping'}
                  </Button>
                </div>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {jiraStatuses.map((js) => (
                    <label key={js} className="flex items-center gap-2 text-xs">
                      <span
                        className={cx(
                          'w-28 shrink-0 font-mono',
                          effectiveMap[js] ? 'text-slate-300' : 'text-amber-500'
                        )}
                      >
                        {js}
                      </span>
                      <span className="text-slate-700">→</span>
                      <select
                        className="flex-1 text-xs"
                        value={effectiveMap[js] ?? ''}
                        onChange={(e) => setMapDraft((d) => ({ ...d, [js]: e.target.value }))}
                      >
                        <option value="">— do not move —</option>
                        {TASK_STATUSES.map((st) => (
                          <option key={st.value} value={st.value}>
                            {st.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
                {sinMapear.length > 0 && (
                  <p className="mt-2 text-xs text-amber-500">
                    No mapping for: {sinMapear.join(', ')}. Those tasks will not move.
                  </p>
                )}
              </div>
            )}

            <p className="text-xs text-slate-600">
              The development estimate and logged time are never touched. Status only moves if you have
              set its mapping above.
            </p>

            {preview && (
              <div className="rounded-lg border border-[var(--color-ink-700)] bg-[var(--color-ink-900)]/60 p-3">
                <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                  <span className="text-slate-400">
                    Matched <strong className="text-slate-100">{preview.matched}</strong> of{' '}
                    {preview.received}
                  </span>
                  {done && (
                    <span className="text-emerald-400">
                      {preview.updated} tasks updated
                      {preview.created > 0 && `, ${preview.created} created`}
                    </span>
                  )}
                  {!done && preview.createCount > 0 && (
                    <span className="text-sky-400">{preview.createCount} would be created</span>
                  )}
                  {preview.unknown.length > 0 && (
                    <span className="text-slate-500">
                      {preview.unknown.length} not in the sprint
                    </span>
                  )}
                </div>

                {preview.blockedChanges.length > 0 && (
                  <p className="mt-2 text-xs text-rose-300">
                    Marked as blocked: {preview.blockedChanges.join(', ')}
                  </p>
                )}
                {preview.statusChanges?.length > 0 && (
                  <details className="mt-2 text-xs" open>
                    <summary className="cursor-pointer text-sky-400">
                      {done ? 'Statuses moved' : 'Will move'}: {preview.statusChanges.length} tasks
                    </summary>
                    <table className="mt-1 w-full">
                      <tbody className="divide-y divide-[var(--color-ink-800)]">
                        {preview.statusChanges.map((c: any) => (
                          <tr key={c.key}>
                            <td className="py-1 font-mono text-slate-400">{c.key}</td>
                            <td className="py-1 text-slate-600">{c.jira}</td>
                            <td className="py-1 text-slate-500">{c.from}</td>
                            <td className="py-1 text-slate-700">→</td>
                            <td className="py-1 text-emerald-400">{c.to}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                )}
                {preview.unmappedStatuses?.length > 0 && (
                  <p className="mt-1 text-xs text-amber-500">
                    No mapping, will not move: {preview.unmappedStatuses.join(', ')}
                  </p>
                )}
                {preview.typeChanges.length > 0 && (
                  <p className="mt-1 text-xs text-slate-500">
                    Type changes: {preview.typeChanges.join(', ')}
                  </p>
                )}
                {preview.carriedOver.length > 0 && (
                  <p className="mt-1 text-xs text-amber-500">
                    Carried over:{' '}
                    {preview.carriedOver.map((c: any) => `${c.key} (${c.sprints} sprints)`).join(', ')}
                  </p>
                )}

                <details className="mt-2 text-xs">
                  <summary className="cursor-pointer text-slate-500 hover:text-slate-300">
                    Status here vs status in Jira
                  </summary>
                  <table className="mt-1 w-full">
                    <tbody className="divide-y divide-[var(--color-ink-800)]">
                      {preview.statusDivergence.map((r: any) => (
                        <tr key={r.key}>
                          <td className="py-1 font-mono text-slate-400">{r.key}</td>
                          <td className="py-1 text-slate-500">{r.appStatus}</td>
                          <td className="py-1 text-slate-700">→</td>
                          <td className="py-1 text-slate-300">{r.jiraStatus}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button onClick={() => run.mutate(true)} disabled={run.isPending || !rows.length}>
                Dry run
              </Button>
              <Button
                variant="primary"
                onClick={() => run.mutate(false)}
                disabled={run.isPending || !preview || !rows.length}
              >
                {done ? 'Re-import' : 'Import'}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
