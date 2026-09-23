import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { typeMeta, trackMeta } from '../lib/types';
import { Button, Empty, Modal, cx } from './ui';

const SEV: Record<string, { label: string; color: string; bg: string }> = {
  high: { label: 'High', color: '#f43f5e', bg: 'border-rose-900/70 bg-rose-950/30' },
  medium: { label: 'Medium', color: '#fbbf24', bg: 'border-amber-900/60 bg-amber-950/20' },
  info: { label: 'Info', color: '#38bdf8', bg: 'border-[var(--color-ink-700)] bg-[var(--color-ink-900)]/60' },
};

const n = (v: number | null | undefined, suf = '') => (v == null ? '—' : `${v}${suf}`);

/** Builds the report as Markdown, for copying or saving. */
function toMarkdown(d: any): string {
  const L: string[] = [];
  const s = d.sum;
  L.push(`# Sprint report · ${d.sprint.name}`);
  L.push('');
  L.push(`_${d.sprint.start_date} → ${d.sprint.end_date} · generated on ${d.generatedAt.slice(0, 10)}_`);
  if (d.sprint.goal) L.push(`\n**Goal:** ${d.sprint.goal}`);
  L.push('');
  L.push('## Summary');
  L.push('');
  L.push('| | |');
  L.push('| --- | --- |');
  L.push(`| Calendar elapsed | ${n(d.progress.timePct, '%')} (${n(d.progress.elapsed)} of ${n(d.progress.totalDays)} working days, ${n(d.progress.daysLeft)} left) |`);
  L.push(`| Work delivered | ${s.deliveredHours} h of ${s.estimateHours} h (${d.progress.deliveredPct}%) |`);
  L.push(`| Tasks closed | ${s.tasksDone} of ${s.tasks} (${s.completionRate}%) |`);
  L.push(`| Development hours logged | ${s.loggedHours} h |`);
  L.push(`| Sprint capacity | ${n(s.teamCapacity, ' h')} · utilisation ${n(s.teamUtilization, '%')} |`);
  L.push(`| Estimate deviation | ${s.deltaDone >= 0 ? '+' : ''}${s.deltaDone} h (${n(s.deviationPct, '%')}) |`);
  L.push(`| Overrun / underrun | ${s.overrunHours} h / ${s.underrunHours} h |`);
  L.push(`| Expected spillover | ${s.spilloverTasks} tasks |`);
  L.push('');
  L.push(`## Points of attention (${d.counts.high} high, ${d.counts.medium} medium, ${d.counts.info} informational)`);
  for (const sev of ['high', 'medium', 'info']) {
    const fs = d.findings.filter((f: any) => f.sev === sev);
    if (!fs.length) continue;
    L.push('');
    L.push(`### ${SEV[sev].label}`);
    for (const f of fs) {
      L.push('');
      L.push(`**[${f.area}] ${f.title}**`);
      L.push('');
      L.push(f.detail);
      if (f.evidence?.length) for (const e of f.evidence) L.push(`- ${e}`);
    }
  }
  L.push('');
  L.push('## Real velocity and next sprint');
  L.push('');
  L.push(`- **Real velocity**: ${d.velocity.deliveredEstimate} h of estimate closed ` +
    `(${d.velocity.tasksDone} of ${d.velocity.tasksTotal} tasks, ${d.velocity.deliveryRatio}% of what was committed).`);
  L.push(`- **Typical task**: ${d.velocity.medianEstimateDone ?? '—'} h median, ${d.velocity.avgEstimateDone ?? '—'} h average.`);
  L.push(`- **Cost of an estimated hour**: ${d.velocity.estimateFactor ?? '—'} ` +
    `(${d.velocity.loggedOnDone} h real for ${d.deviation.estimateDone} h estimated).`);
  L.push(`- **Recommended commitment next sprint**: **${d.forecast.recommended} h** of estimate` +
    (d.forecast.equivalentTasks != null ? `, about ${d.forecast.equivalentTasks} tasks of the usual size` : '') +
    ` (confidence factor ${d.forecast.commitFactor}).`);
  L.push('');
  L.push('| Estimate | Closed | Total | Completion | Delivered |');
  L.push('| --- | --- | --- | --- | --- |');
  for (const r of d.doneByEstimate) {
    L.push(`| ${r.estimate === 0 ? 'unestimated' : `${r.estimate} h`} | ${r.done} | ${r.total} | ${r.pctDone}% | ${r.deliveredHours} h |`);
  }
  L.push('');
  L.push('## Time logged per person');
  L.push('');
  L.push('| Person | Hours | Utilisation | Ownership | Own deviation | Support | Focus | Last |');
  L.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const u of d.byUser) {
    L.push(
      `| ${u.name} | ${u.hours} h | ${n(u.utilization, '%')} | ${u.tasksDone}/${u.tasksInProgress}/${u.tasksAssigned} | ` +
        `${u.ownDoneTasks ? `${u.ownDelta > 0 ? '+' : ''}${u.ownDelta} h` : '—'} | ${n(u.supportPct, '%')} | ` +
        `${n(u.focusPct, '%')} | ${n(u.idleDays, 'd')} |`
    );
  }
  L.push('');
  L.push('## Effort split');
  L.push('');
  L.push('| Project | Tasks | Estimated | Actual |');
  L.push('| --- | --- | --- | --- |');
  for (const p of d.byProject) {
    L.push(`| ${p.project_id} | ${p.tasksDone}/${p.tasks} | ${p.estimateHours} h | ${p.loggedHours} h |`);
  }
  L.push('');
  L.push('| Type of work | Hours | % |');
  L.push('| --- | --- | --- |');
  for (const x of d.byType) L.push(`| ${typeMeta(x.type).label} | ${x.hours} h | ${x.pctHours}% |`);
  L.push('');
  for (const x of d.byTrack) {
    L.push(
      `- **${trackMeta(x.track).label}**: ${x.estimateHours} h committed of ${n(x.capacity, ' h')} ` +
        `(${n(x.plannedLoad, '%')}), ${x.loggedHours} h logged.`
    );
  }
  return L.join('\n');
}

export function SprintReport({
  sprintId,
  open,
  onClose,
}: {
  sprintId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [copiado, setCopiado] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ['report', sprintId],
    queryFn: () => api.sprints.report(sprintId),
    enabled: open,
  });

  const md = useMemo(() => (data ? toMarkdown({ ...data, sum: data.summary }) : ''), [data]);

  const copiar = async () => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(md);
      else throw new Error('no clipboard api');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = md;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  };

  const descargar = () => {
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `report-${sprintId}-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Modal open={open} onClose={onClose} wide title="Sprint report">
      {isLoading ? (
        <p className="text-sm text-slate-500">Analysing the sprint…</p>
      ) : error ? (
        <Empty>{(error as Error).message}</Empty>
      ) : !data ? null : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-500">
              {data.sprint.start_date} → {data.sprint.end_date} · generated on{' '}
              {data.generatedAt.slice(0, 10)}
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant={copiado ? 'primary' : 'default'} onClick={copiar}>
                {copiado ? '✓ copied' : '⧉ copy as Markdown'}
              </Button>
              <Button size="sm" onClick={descargar}>
                ↓ download
              </Button>
            </div>
          </div>

          {/* resumen */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              {
                l: 'Calendar',
                v: `${n(data.progress.timePct, '%')}`,
                s: `${n(data.progress.daysLeft)} working days left`,
              },
              {
                l: 'Delivered',
                v: `${data.summary.deliveredHours} h`,
                s: `of ${data.summary.estimateHours} h (${data.progress.deliveredPct}%)`,
              },
              {
                l: 'Actual time logged',
                v: `${data.summary.loggedHours} h`,
                s: `utilisation ${n(data.summary.teamUtilization, '%')}`,
              },
              {
                l: 'Deviation',
                v: `${data.summary.deltaDone >= 0 ? '+' : ''}${data.summary.deltaDone} h`,
                s: `overrun ${data.summary.overrunHours} h · underrun ${data.summary.underrunHours} h`,
              },
            ].map((x) => (
              <div
                key={x.l}
                className="rounded-lg border border-[var(--color-ink-800)] bg-[var(--color-ink-900)]/60 px-3 py-2"
              >
                <div className="text-[10px] uppercase tracking-wide text-slate-500">{x.l}</div>
                <div className="text-lg font-semibold text-slate-100">{x.v}</div>
                <div className="text-[11px] text-slate-600">{x.s}</div>
              </div>
            ))}
          </div>

          {/* hallazgos */}
          <div>
            <h4 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Points of attention · {data.counts.high} high, {data.counts.medium} medium,{' '}
              {data.counts.info} informational
            </h4>
            {data.findings.length === 0 ? (
              <Empty>Nothing worth flagging. The sprint is on track.</Empty>
            ) : (
              <ul className="flex flex-col gap-2">
                {data.findings.map((f: any, i: number) => (
                  <li key={i} className={cx('rounded-lg border px-3 py-2', SEV[f.sev].bg)}>
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span
                        className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase"
                        style={{ color: SEV[f.sev].color, backgroundColor: `${SEV[f.sev].color}1f` }}
                      >
                        {SEV[f.sev].label}
                      </span>
                      <span className="text-[11px] uppercase tracking-wide text-slate-500">
                        {f.area}
                      </span>
                      <span className="flex-1 text-sm font-medium text-slate-100">{f.title}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">{f.detail}</p>
                    {f.evidence?.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {f.evidence.map((e: string, j: number) => (
                          <li key={j} className="font-mono text-[11px] text-slate-600">
                            · {e}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* personas */}
          <div>
            <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Time logged per person
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="pb-1">Person</th>
                    <th className="pb-1 text-right">Hours</th>
                    <th className="pb-1 text-right">Util.</th>
                    <th className="pb-1 text-right">Ownership</th>
                    <th className="pb-1 text-right">Deviation</th>
                    <th className="pb-1 text-right">Support</th>
                    <th className="pb-1 text-right">Focus</th>
                    <th className="pb-1 text-right">Last</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-ink-800)]">
                  {data.byUser.map((u: any) => (
                    <tr key={u.user_id}>
                      <td className="py-1 text-slate-300">{u.name}</td>
                      <td className="py-1 text-right text-slate-200">{u.hours}</td>
                      <td className="py-1 text-right text-slate-400">{n(u.utilization, '%')}</td>
                      <td className="py-1 text-right text-slate-400">
                        {u.tasksAssigned ? `${u.tasksDone}/${u.tasksInProgress}/${u.tasksAssigned}` : '—'}
                      </td>
                      <td
                        className={cx(
                          'py-1 text-right',
                          !u.ownDoneTasks ? 'text-slate-700' : u.ownDelta > 0 ? 'text-rose-400' : 'text-amber-400'
                        )}
                      >
                        {u.ownDoneTasks ? `${u.ownDelta > 0 ? '+' : ''}${u.ownDelta} h` : '—'}
                      </td>
                      <td className="py-1 text-right text-slate-500">{n(u.supportPct, '%')}</td>
                      <td className="py-1 text-right text-slate-500">{n(u.focusPct, '%')}</td>
                      <td className="py-1 text-right text-slate-600">{n(u.idleDays, 'd')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <details className="text-xs">
            <summary className="cursor-pointer text-slate-500 hover:text-slate-300">
              View the Markdown that gets copied
            </summary>
            <pre className="mt-2 max-h-72 overflow-auto rounded-lg border border-[var(--color-ink-800)] bg-[var(--color-ink-950)] p-3 text-[11px] text-slate-400">
              {md}
            </pre>
          </details>
        </div>
      )}
    </Modal>
  );
}
