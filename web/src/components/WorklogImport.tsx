import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import {
  autoMap,
  detectTimeUnit,
  guessUser,
  parseCsv,
  parseDate,
  parseHours,
  parseTimestamp,
  type Csv,
  type TimeUnit,
} from '../lib/csv';
import type { User } from '../lib/types';
import { Button, Empty, ErrorBanner, Field, Modal, cx } from './ui';

/** "19.866666" -> 19.866666; vacío -> null. */
const numOrNull = (v: string) => {
  const n = parseFloat(v.replace(',', '.'));
  return Number.isNaN(n) ? null : n;
};

type Mapping = Record<
  | 'issue_key' | 'parent_key' | 'issue_summary' | 'author' | 'date' | 'hours' | 'comment'
  | 'external_id' | 'original_estimate' | 'remaining_estimate',
  number
>;

const FIELDS: { key: keyof Mapping; label: string; required: boolean; hint?: string }[] = [
  { key: 'issue_key', label: 'Task id', required: true, hint: 'looked up in the sprint first' },
  { key: 'parent_key', label: 'Parent task', required: false, hint: 'fallback when the subtask is absent' },
  { key: 'issue_summary', label: 'Summary', required: false, hint: 'used to fill empty titles' },
  { key: 'author', label: 'Person', required: true },
  { key: 'date', label: 'Date', required: true },
  { key: 'hours', label: 'Time spent', required: true },
  { key: 'comment', label: 'Comment', required: false },
  { key: 'external_id', label: 'Worklog id', required: false, hint: 'when present, dedup is exact' },
  { key: 'original_estimate', label: 'Original estimate', required: false, hint: 'fills the empty ones' },
  { key: 'remaining_estimate', label: 'Remaining work', required: false, hint: 'real progress from Jira' },
];

export function WorklogImport({
  sprintId,
  users,
  open,
  onClose,
}: {
  sprintId: string;
  users: User[];
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  // Varios ficheros: un export de worklog por proyecto, todos del mismo periodo.
  const [files, setFiles] = useState<{ name: string; csv: Csv }[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [map, setMap] = useState<Mapping | null>(null);
  const [unit, setUnit] = useState<TimeUnit>('hours');
  const [dayFirst, setDayFirst] = useState(true);
  const [fillTitles, setFillTitles] = useState(true);
  const [fillEstimates, setFillEstimates] = useState(true);
  const [syncRemaining, setSyncRemaining] = useState(true);
  const [userMap, setUserMap] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<any>(null);

  const reset = () => {
    setFiles([]);
    setParseError(null);
    setMap(null);
    setUserMap({});
    setPreview(null);
  };

  /** El primer fichero fija el mapeo de columnas; el resto se resuelve por nombre. */
  const csv = files[0]?.csv ?? null;

  /** Añade ficheros al lote. El primero fija el mapeo de columnas y la unidad. */
  const loadFiles = async (list: File[]) => {
    try {
      const read = await Promise.all(
        list.map(async (f) => ({ name: f.name, csv: parseCsv(await f.text()) }))
      );
      const vacios = read.filter((r) => !r.csv.headers.length || !r.csv.rows.length);
      if (vacios.length) {
        setParseError(`These files have no data rows: ${vacios.map((v) => v.name).join(', ')}`);
        return;
      }
      setParseError(null);
      setPreview(null);
      setFiles((prev) => {
        const nuevos = read.filter((r) => !prev.some((p) => p.name === r.name));
        const all = [...prev, ...nuevos];
        if (!prev.length && all.length) {
          const first = all[0].csv;
          const m = autoMap(first.headers) as unknown as Mapping;
          setMap(m);
          if (m.hours >= 0) {
            setUnit(detectTimeUnit(first.headers[m.hours], first.rows.map((r) => r[m.hours] ?? '')));
          }
        }
        return all;
      });
    } catch (e) {
      setParseError((e as Error).message);
    }
  };

  const loadText = (text: string, name: string) => {
    try {
      const parsed = parseCsv(text);
      if (!parsed.headers.length || !parsed.rows.length) {
        setParseError('The file has no data rows.');
        return;
      }
      const m = autoMap(parsed.headers) as unknown as Mapping;
      setFiles([{ name, csv: parsed }]);
      setMap(m);
      setParseError(null);
      setPreview(null);

      if (m.hours >= 0) {
        setUnit(detectTimeUnit(parsed.headers[m.hours], parsed.rows.map((r) => r[m.hours] ?? '')));
      }
      if (m.author >= 0) {
        const authors = [...new Set(parsed.rows.map((r) => (r[m.author] ?? '').trim()).filter(Boolean))];
        // Sólo se empareja contra gente activa: desactivar a alguien basta para
        // dejarlo fuera de las importaciones sin perder su histórico.
        const active = users.filter((u) => u.active);
        setUserMap(Object.fromEntries(authors.map((a) => [a, guessUser(a, active)])));
      }
    } catch (e) {
      setParseError((e as Error).message);
    }
  };

  /* --------------------------------------------------- filas normalizadas */

  const parsed = useMemo(() => {
    if (!csv || !map) return null;
    const ok: any[] = [];
    const bad: { line: number; reason: string; raw: string; file?: string }[] = [];

    // Las columnas se fijan por NOMBRE a partir del primer fichero, así que un
    // export con las columnas en otro orden se lee igual de bien.
    const headerOf = (idx: number) => (idx >= 0 ? csv.headers[idx] : null);
    const names = Object.fromEntries(
      (Object.keys(map) as (keyof Mapping)[]).map((k) => [k, headerOf(map[k])])
    ) as Record<keyof Mapping, string | null>;

    for (const file of files) {
    const idxOf = (k: keyof Mapping) => {
      const n = names[k];
      return n == null ? -1 : file.csv.headers.findIndex((h) => h.trim() === n.trim());
    };
    const fm = Object.fromEntries(
      (Object.keys(map) as (keyof Mapping)[]).map((k) => [k, idxOf(k)])
    ) as unknown as Mapping;

    file.csv.rows.forEach((r, i) => {
      const cell = (idx: number) => (idx >= 0 ? (r[idx] ?? '').trim() : '');
      const issue_key = cell(fm.issue_key);
      const author = cell(fm.author);
      const rawDate = cell(fm.date);
      const rawHours = cell(fm.hours);

      const date = parseDate(rawDate, dayFirst);
      const hours = parseHours(rawHours, unit);

      const line = i + 2; // +1 por la cabecera, +1 porque los humanos cuentan desde 1
      if (!issue_key) bad.push({ line, reason: 'no task id', raw: r.join(' | ').slice(0, 90), file: file.name });
      else if (!author) bad.push({ line, reason: 'no person', raw: issue_key, file: file.name });
      else if (!date) bad.push({ line, reason: `unreadable date: «${rawDate}»`, raw: issue_key, file: file.name });
      else if (hours == null || hours <= 0)
        bad.push({ line, reason: `unreadable time: «${rawHours}»`, raw: issue_key, file: file.name });
      else {
        const time = parseTimestamp(rawDate);
        ok.push({
          issue_key,
          parent_key: cell(fm.parent_key) || null,
          issue_summary: cell(fm.issue_summary) || null,
          original_estimate: numOrNull(cell(fm.original_estimate)),
          remaining_estimate: numOrNull(cell(fm.remaining_estimate)),
          author,
          date,
          // 4 decimales: Tempo exporta 0.9833333…, redondear a 2 acumularía deriva
          hours: Math.round(hours * 10000) / 10000,
          comment: cell(fm.comment) || null,
          external_id: cell(fm.external_id) || null,
          source_ts: time ? `${date} ${time}` : null,
        });
      }
    });
    }

    return { ok, bad };
  }, [files, csv, map, unit, dayFirst]);

  const authors = useMemo(
    () => [...new Set((parsed?.ok ?? []).map((r) => r.author as string))].sort(),
    [parsed]
  );
  // Se propone emparejamiento para cualquier persona nueva que aparezca al añadir
  // más ficheros, sin tocar lo que ya hayas decidido a mano.
  useEffect(() => {
    const active = users.filter((u) => u.active);
    setUserMap((prev) => {
      const faltan = authors.filter((a) => !(a in prev));
      if (!faltan.length) return prev;
      return { ...prev, ...Object.fromEntries(faltan.map((a) => [a, guessUser(a, active)])) };
    });
  }, [authors, users]);

  const unmappedAuthors = authors.filter((a) => !userMap[a]);
  const hasExternalId = !!map && map.external_id >= 0;
  const hasTime = (parsed?.ok ?? []).some((r) => r.source_ts);

  const missingRequired = FIELDS.filter((f) => f.required && (!map || map[f.key] < 0)).map((f) => f.label);

  /* ------------------------------------------------------------ mutaciones */

  const run = useMutation({
    mutationFn: (dry: boolean) =>
      api.sprints.importWorklogs(sprintId, {
        dry_run: dry,
        rows: parsed?.ok ?? [],
        user_map: userMap,
        fill_titles: fillTitles,
        fill_estimates: fillEstimates,
        sync_remaining: syncRemaining,
      }),
    onSuccess: (res) => {
      setPreview(res);
      if (!res.dry_run) {
        qc.invalidateQueries({ queryKey: ['tasks', sprintId] });
        qc.invalidateQueries({ queryKey: ['metrics', sprintId] });
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
      title="Import Jira worklog"
    >
      <div className="flex flex-col gap-4">
        <ErrorBanner error={parseError ?? run.error} />

        {/* ------------------------------------------------------ 1. fichero */}
        {!csv ? (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-slate-500">
              Export the worklog from Jira as CSV and drop it here. The separator (comma or
              semicolon), the columns and the time format are all detected automatically. You can
              pick <strong className="text-slate-300">several files at once</strong>, one per
              project: columns are resolved by name, so a different column order is fine.
            </p>
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-[var(--color-ink-700)] px-4 py-8 text-sm text-slate-500 hover:border-sky-600 hover:text-slate-300">
              <span className="text-2xl">📄</span>
              <span>Choose CSV files</span>
              <input
                type="file"
                accept=".csv,text/csv,text/plain"
                multiple
                className="hidden"
                onChange={(e) => {
                  const list = e.target.files;
                  if (!list?.length) return;
                  loadFiles([...list]);
                }}
              />
            </label>
            <details className="text-xs text-slate-600">
              <summary className="cursor-pointer hover:text-slate-400">Or paste the contents</summary>
              <textarea
                rows={5}
                className="mt-2 w-full font-mono text-xs"
                placeholder="Issue Key,Author,Started,Time Spent…"
                onBlur={(e) => e.target.value.trim() && loadText(e.target.value, 'pegado')}
              />
            </details>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between rounded-md border border-[var(--color-ink-700)] bg-[var(--color-ink-900)]/60 px-3 py-2 text-xs">
              <span className="text-slate-400">
                <strong className="text-slate-200">{files.length}</strong>{' '}
                {files.length === 1 ? 'file' : 'files'} ·{' '}
                {files.reduce((a, f) => a + f.csv.rows.length, 0)} rows · separator «
                {csv.delimiter === '\t' ? 'tab' : csv.delimiter}»
              </span>
              <Button size="sm" variant="ghost" onClick={reset}>
                Start over
              </Button>
            </div>

            {/* --------------------------------------------------- 2. columnas */}
            {!done && (
              <div className="rounded-lg border border-[var(--color-ink-700)] bg-[var(--color-ink-900)]/60 p-3">
                <h4 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Columnas
                </h4>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {FIELDS.map((f) => (
                    <Field key={f.key} label={f.label + (f.required ? ' *' : '')} hint={f.hint}>
                      <select
                        value={map?.[f.key] ?? -1}
                        onChange={(e) =>
                          setMap((m) => (m ? { ...m, [f.key]: Number(e.target.value) } : m))
                        }
                        className="text-xs"
                      >
                        <option value={-1}>— ninguna —</option>
                        {csv.headers.map((h, i) => (
                          <option key={i} value={i}>
                            {h || `(columna ${i + 1})`}
                          </option>
                        ))}
                      </select>
                    </Field>
                  ))}
                </div>

                <div className="mt-3 flex flex-wrap items-end gap-4 border-t border-[var(--color-ink-800)] pt-3">
                  <Field label="Time unit">
                    <select
                      value={unit}
                      onChange={(e) => setUnit(e.target.value as TimeUnit)}
                      className="text-xs"
                    >
                      <option value="hours">Horas (7,5)</option>
                      <option value="seconds">Segundos (27000)</option>
                      <option value="jira">Texto Jira (1d 2h 30m)</option>
                    </select>
                  </Field>
                  <label className="flex items-center gap-2 pb-1.5 text-xs text-slate-400">
                    <input
                      type="checkbox"
                      className="size-4 accent-sky-500"
                      checked={dayFirst}
                      onChange={(e) => setDayFirst(e.target.checked)}
                    />
                    Dates in day/month format
                  </label>
                  <label className="flex items-center gap-2 pb-1.5 text-xs text-slate-400">
                    <input
                      type="checkbox"
                      className="size-4 accent-sky-500"
                      checked={fillTitles}
                      onChange={(e) => setFillTitles(e.target.checked)}
                    />
                    Fill empty titles from the summary (stripping «[DEV]»)
                  </label>
                  <label className="flex items-center gap-2 pb-1.5 text-xs text-slate-400">
                    <input
                      type="checkbox"
                      className="size-4 accent-sky-500"
                      checked={fillEstimates}
                      onChange={(e) => setFillEstimates(e.target.checked)}
                    />
                    Fill empty estimates from Jira
                  </label>
                  <label className="flex items-center gap-2 pb-1.5 text-xs text-slate-400">
                    <input
                      type="checkbox"
                      className="size-4 accent-sky-500"
                      checked={syncRemaining}
                      onChange={(e) => setSyncRemaining(e.target.checked)}
                    />
                    Refresh the remaining work
                  </label>
                  <span
                    className={cx(
                      'ml-auto rounded-full px-2 py-0.5 text-[11px]',
                      hasExternalId
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : 'bg-amber-500/15 text-amber-400'
                    )}
                  >
                    {hasExternalId
                      ? 'Exact dedup by worklog id'
                      : hasTime
                        ? 'Dedup by task + person + date and time + hours'
                        : 'No id or time: dedup by task + person + date + hours'}
                  </span>
                </div>
              </div>
            )}

            {/* ------------------------------------------- 3. vista previa filas */}
            {parsed && !done && (
              <div>
                <div className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-wide text-slate-500">
                  <span>How the rows are being read</span>
                  <span>
                    {parsed.ok.length} valid
                    {parsed.bad.length > 0 && (
                      <span className="text-amber-500"> · {parsed.bad.length} with problems</span>
                    )}
                  </span>
                </div>
                {parsed.ok.length === 0 ? (
                  <Empty>
                    Ninguna fila se lee bien. Revisa el mapeo de columnas
                    {missingRequired.length > 0 && `: falta ${missingRequired.join(', ')}`}.
                  </Empty>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-slate-500">
                        <th className="pb-1">Task</th>
                        <th className="pb-1">Person</th>
                        <th className="pb-1">Date</th>
                        <th className="pb-1 text-right">Hours</th>
                        <th className="pb-1">Comentario</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-ink-800)]">
                      {parsed.ok.slice(0, 5).map((r, i) => (
                        <tr key={i}>
                          <td className="py-1 font-mono text-slate-300">{r.issue_key}</td>
                          <td className="py-1 text-slate-400">{r.author}</td>
                          <td className="py-1 text-slate-400">{r.date}</td>
                          <td className="py-1 text-right text-slate-200">{r.hours}</td>
                          <td className="py-1 max-w-40 truncate text-slate-600">{r.comment ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {parsed.bad.length > 0 && (
                  <details className="mt-2 text-xs text-amber-500">
                    <summary className="cursor-pointer">View the {parsed.bad.length} problem rows</summary>
                    <ul className="mt-1 space-y-0.5 text-slate-500">
                      {parsed.bad.slice(0, 20).map((b, i) => (
                        <li key={i}>
                          {b.file && <span className="text-slate-700">{b.file} </span>}
                          line {b.line}: {b.reason} <span className="text-slate-700">({b.raw})</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}

            {/* ------------------------------------------------ 4. personas */}
            {authors.length > 0 && !done && (
              <div className="rounded-lg border border-[var(--color-ink-700)] bg-[var(--color-ink-900)]/60 p-3">
                <h4 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Personas ({authors.length})
                  {unmappedAuthors.length > 0 && (
                    <span className="ml-2 text-amber-500">
                      {unmappedAuthors.length} unassigned, sus horas se ignoran
                    </span>
                  )}
                </h4>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {authors.map((a) => (
                    <div key={a} className="flex items-center gap-2">
                      <span className="flex-1 truncate text-xs text-slate-300" title={a}>
                        {a}
                      </span>
                      <span className="text-slate-700">→</span>
                      <select
                        value={userMap[a] ?? ''}
                        onChange={(e) => setUserMap((m) => ({ ...m, [a]: e.target.value }))}
                        className="w-40 text-xs"
                      >
                        <option value="">— ignore —</option>
                        {users.filter((u) => u.active).map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* -------------------------------------------------- 5. resultado */}
            {preview && (
              <div
                className={cx(
                  'rounded-lg border p-3',
                  done
                    ? 'border-emerald-900/70 bg-emerald-950/30'
                    : 'border-[var(--color-ink-700)] bg-[var(--color-ink-900)]/60'
                )}
              >
                <h4 className="mb-2 text-sm font-semibold text-slate-200">
                  {done ? 'Import finished' : 'Dry run (nothing saved)'}
                </h4>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div>
                    <div className="text-[11px] uppercase text-slate-500">
                      {done ? 'Imported' : 'Will import'}
                    </div>
                    <div className="text-xl font-semibold text-emerald-400">
                      {done ? preview.imported : preview.toImport}
                    </div>
                    <div className="text-[11px] text-slate-600">{preview.hoursToImport} h</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase text-slate-500">Duplicates</div>
                    <div className="text-xl font-semibold text-slate-400">{preview.duplicates}</div>
                    <div className="text-[11px] text-slate-600">
                      {preview.duplicatesById > 0 && `${preview.duplicatesById} by id`}
                      {preview.duplicatesById > 0 && preview.duplicatesByFingerprint > 0 && ' · '}
                      {preview.duplicatesByFingerprint > 0 &&
                        `${preview.duplicatesByFingerprint} by content`}
                      {preview.duplicates === 0 && 'ninguna'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase text-slate-500">Outside the sprint</div>
                    {/* No es un error: las ceremonias y la gestión no son tareas del sprint. */}
                    <div className="text-xl font-semibold text-slate-400">
                      {preview.unknownTasks.length}
                    </div>
                    <div className="text-[11px] text-slate-600">not imported</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase text-slate-500">Unmapped people</div>
                    <div
                      className={cx(
                        'text-xl font-semibold',
                        preview.unknownAuthors.length ? 'text-amber-400' : 'text-slate-400'
                      )}
                    >
                      {preview.unknownAuthors.length}
                    </div>
                  </div>
                </div>

                {preview.viaParent?.length > 0 && (
                  <details className="mt-3 text-xs">
                    <summary className="cursor-pointer text-sky-400">
                      {preview.viaParentRows} subtask entries roll up to their parent task
                    </summary>
                    <ul className="mt-1 space-y-0.5 text-slate-500">
                      {preview.viaParent.map((t: any) => (
                        <li key={t.issue_key} className="font-mono">
                          {t.issue_key} <span className="text-slate-700">→</span> {t.parent}{' '}
                          <span className="text-slate-700">({t.hours} h)</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                {preview.unknownParents?.length > 0 && (
                  <details className="mt-3 text-xs">
                    <summary className="cursor-pointer text-slate-500 hover:text-slate-300">
                      Outside the sprint: {preview.unknownParents.length} tasks,{' '}
                      {preview.unknownParents
                        .reduce((a: number, p: any) => a + p.hours, 0)
                        .toFixed(2)}{' '}
                      h not imported
                      <span className="ml-1 text-slate-700">
                        (ceremonies and management land here; that is expected)
                      </span>
                    </summary>
                    <table className="mt-1 w-full">
                      <tbody className="divide-y divide-[var(--color-ink-800)]">
                        {preview.unknownParents.map((p: any) => (
                          <tr key={p.key}>
                            <td className="py-1 font-mono text-slate-300">{p.key}</td>
                            <td className="py-1 text-slate-600">
                              {p.children.length > 0
                                ? `parent of ${p.children.join(', ')}`
                                : 'no subtasks'}
                            </td>
                            <td className="py-1 text-right text-slate-400">{p.hours} h</td>
                            <td className="py-1 text-right text-slate-600">{p.rows} entries</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                )}

                {preview.estimates?.length > 0 && (
                  <details className="mt-3 text-xs">
                    <summary className="cursor-pointer text-sky-400">
                      Estimate and progress from Jira ({preview.estimates.length} tasks)
                      {done && ` · ${preview.estimatesSet} estimates filled, ${preview.remainingSynced} remaining values refreshed`}
                    </summary>
                    <table className="mt-1 w-full">
                      <thead>
                        <tr className="text-left text-slate-500">
                          <th className="pb-1">Task</th>
                          <th className="pb-1 text-right">Here</th>
                          <th className="pb-1 text-right">Jira est.</th>
                          <th className="pb-1 text-right">Remaining</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--color-ink-800)]">
                        {preview.estimates.map((e: any) => (
                          <tr key={e.key}>
                            <td className="py-1 font-mono text-slate-400">{e.key}</td>
                            <td className={cx('py-1 text-right', e.fills ? 'text-amber-400' : 'text-slate-500')}>
                              {e.current ?? '— empty —'}
                            </td>
                            <td className="py-1 text-right text-slate-300">{e.estimate ?? '—'}</td>
                            <td
                              className={cx(
                                'py-1 text-right',
                                e.remaining === 0 ? 'text-emerald-400' : 'text-slate-300'
                              )}
                            >
                              {e.remaining ?? '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                )}

                {preview.titles?.length > 0 && (
                  <details className="mt-3 text-xs">
                    <summary className="cursor-pointer text-sky-400">
                      {done ? `${preview.titlesSet} titles filled` : `${preview.titles.length} titles will be filled`}
                    </summary>
                    <table className="mt-1 w-full">
                      <tbody className="divide-y divide-[var(--color-ink-800)]">
                        {preview.titles.map((t: any) => (
                          <tr key={t.key}>
                            <td className="w-28 py-1 font-mono text-slate-400">{t.key}</td>
                            <td className="py-1 text-slate-300">{t.title}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                )}

                {preview.byUser.length > 0 && (
                  <div className="mt-3 border-t border-[var(--color-ink-800)] pt-2 text-xs">
                    <div className="mb-1 text-[11px] uppercase text-slate-500">Reparto</div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-slate-400">
                      {preview.byUser.map((u: any) => (
                        <span key={u.user_id}>
                          {users.find((x) => x.id === u.user_id)?.name ?? u.user_id}{' '}
                          <span className="text-slate-200">{u.hours} h</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ---------------------------------------------------- 6. acciones */}
            <div className="flex items-center justify-end gap-2">
              {done ? (
                <>
                  <Button variant="ghost" onClick={reset}>
                    Importar otro fichero
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => {
                      reset();
                      onClose();
                    }}
                  >
                    Cerrar
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="ghost" onClick={onClose}>
                    Cancelar
                  </Button>
                  <Button
                    onClick={() => run.mutate(true)}
                    disabled={!parsed?.ok.length || missingRequired.length > 0 || run.isPending}
                  >
                    {run.isPending ? 'Comprobando…' : 'Simular'}
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => run.mutate(false)}
                    disabled={!preview || preview.toImport === 0 || run.isPending}
                    title={!preview ? 'Run a dry run first to see what would come in' : undefined}
                  >
                    Importar {preview ? `${preview.toImport} worklogs` : ''}
                  </Button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
