import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Capacity, Sprint } from '../lib/types';
import { Button, Empty, ErrorBanner, Modal, cx } from './ui';

/**
 * Capacidad por sprint. La del usuario es sólo el valor por defecto: aquí se
 * ajusta lo que realmente puede dedicar cada persona en ESTE sprint
 * (vacaciones, bajas, dedicación parcial a otro equipo…).
 */
export function CapacityEditor({
  sprintId,
  sprints,
  open,
  onClose,
}: {
  sprintId: string;
  sprints: Sprint[];
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { data: capacities = [], isLoading } = useQuery({
    queryKey: ['capacities', sprintId],
    queryFn: () => api.sprints.capacities(sprintId),
    enabled: open,
  });

  const [draft, setDraft] = useState<Record<string, string>>({});
  const [bulk, setBulk] = useState('');
  const [discoveryPct, setDiscoveryPct] = useState('20');

  const sprint = sprints.find((s) => s.id === sprintId);

  useEffect(() => {
    if (!open) return;
    setDraft(
      Object.fromEntries(
        capacities.map((c) => [c.user_id, c.sprint_hours != null ? String(c.sprint_hours) : ''])
      )
    );
  }, [open, capacities]);

  useEffect(() => {
    if (!open || !sprint) return;
    // sin redondear a entero: hay repartos con decimales (un tercio = 33.3333 %)
    setDiscoveryPct(String(+(Number(sprint.discovery_ratio ?? 0.20) * 100).toFixed(4)));
  }, [open, sprint?.discovery_ratio]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['capacities', sprintId] });
    qc.invalidateQueries({ queryKey: ['metrics', sprintId] });
    qc.invalidateQueries({ queryKey: ['sprint', sprintId] });
    qc.invalidateQueries({ queryKey: ['sprints'] });
  };

  const save = useMutation({
    mutationFn: async () => {
      await api.sprints.update(sprintId, {
        discovery_ratio: Math.min(Math.max(Number(discoveryPct) || 0, 0), 100) / 100,
      });
      return api.sprints.saveCapacities(
        sprintId,
        capacities.map((c) => ({
          user_id: c.user_id,
          capacity_hours: draft[c.user_id]?.trim() === '' ? null : Number(draft[c.user_id]),
        }))
      );
    },
    onSuccess: () => {
      refresh();
      onClose();
    },
  });

  const copy = useMutation({
    mutationFn: (from: string) => api.sprints.copyCapacities(sprintId, from),
    onSuccess: (rows) => {
      setDraft(
        Object.fromEntries(rows.map((c) => [c.user_id, c.sprint_hours != null ? String(c.sprint_hours) : '']))
      );
      refresh();
    },
  });

  const effective = (c: Capacity) => {
    const v = draft[c.user_id];
    if (v === undefined) return c.effective_hours;
    if (v.trim() === '') return c.default_hours ?? 0;
    return Number(v) || 0;
  };

  const total = useMemo(
    () => capacities.reduce((a, c) => a + effective(c), 0),
    [capacities, draft]
  );

  const pct = Math.min(Math.max(Number(discoveryPct) || 0, 0), 100);
  const discoveryHours = (total * pct) / 100;
  const deliveryHours = total - discoveryHours;

  const others = sprints.filter((s) => s.id !== sprintId);

  return (
    <Modal open={open} onClose={onClose} wide title="Capacity and split for this sprint">
      {isLoading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : capacities.length === 0 ? (
        <Empty>Create users first.</Empty>
      ) : (
        <div className="flex flex-col gap-4">
          <ErrorBanner error={save.error ?? copy.error} />

          <p className="text-xs text-slate-500">
            These hours are for <strong className="text-slate-300">this sprint</strong>. Leave the field
            empty to use the person's default capacity. Set 0 for anyone not taking part.
          </p>

          <div className="flex flex-wrap items-end gap-2 rounded-lg border border-[var(--color-ink-700)] bg-[var(--color-ink-900)]/60 p-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wide text-slate-500">
                Apply to everyone
              </span>
              <input
                type="number"
                min="0"
                step="1"
                value={bulk}
                onChange={(e) => setBulk(e.target.value)}
                placeholder="60"
                className="w-24"
              />
            </label>
            <Button
              size="sm"
              disabled={bulk.trim() === ''}
              onClick={() =>
                setDraft(Object.fromEntries(capacities.filter((c) => c.active).map((c) => [c.user_id, bulk])))
              }
            >
              Apply
            </Button>

            {others.length > 0 && (
              <div className="ml-auto flex items-end gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] uppercase tracking-wide text-slate-500">
                    Copy from another sprint
                  </span>
                  <select
                    defaultValue=""
                    onChange={(e) => e.target.value && copy.mutate(e.target.value)}
                    className="text-xs"
                  >
                    <option value="">— pick a sprint —</option>
                    {others.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="pb-2">Person</th>
                <th className="pb-2 text-right">Default</th>
                <th className="pb-2 text-right">This sprint</th>
                <th className="pb-2 text-right">Effective</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-ink-800)]">
              {capacities.map((c) => {
                const eff = effective(c);
                const overridden = (draft[c.user_id] ?? '').trim() !== '';
                return (
                  <tr key={c.user_id} className={c.active ? '' : 'opacity-50'}>
                    <td className="py-2 text-slate-200">
                      {c.name}
                      {!c.active && <span className="ml-2 text-[11px] text-slate-600">(inactive)</span>}
                    </td>
                    <td className="py-2 text-right text-slate-600">
                      {c.default_hours != null ? `${c.default_hours} h` : '—'}
                    </td>
                    <td className="py-2 text-right">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        className="w-24 text-right"
                        placeholder={c.default_hours != null ? String(c.default_hours) : '0'}
                        value={draft[c.user_id] ?? ''}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, [c.user_id]: e.target.value }))
                        }
                      />
                    </td>
                    <td
                      className={cx(
                        'py-2 text-right font-medium',
                        eff === 0 ? 'text-slate-600' : overridden ? 'text-sky-400' : 'text-slate-300'
                      )}
                    >
                      {eff} h
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-[var(--color-ink-700)]">
                <td className="pt-2 text-slate-400">Total sprint capacity</td>
                <td />
                <td />
                <td className="pt-2 text-right text-lg font-semibold text-slate-100">{total} h</td>
              </tr>
            </tfoot>
          </table>

          {/* ------------------------------------- reparto delivery / discovery */}
          <div className="rounded-lg border border-[var(--color-ink-700)] bg-[var(--color-ink-900)]/60 p-3">
            <div className="flex flex-wrap items-end gap-4">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] uppercase tracking-wide text-slate-500">
                  % reserved for discovery
                </span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.0001"
                  value={discoveryPct}
                  onChange={(e) => setDiscoveryPct(e.target.value)}
                  className="w-24"
                />
              </label>
              <div className="flex gap-1">
                {[
                  { label: '0%', value: '0' },
                  { label: '20%', value: '20' },
                  { label: '25%', value: '25' },
                  { label: '⅓', value: '33.3333' },
                  { label: '50%', value: '50' },
                ].map((p) => (
                  <Button key={p.label} size="sm" onClick={() => setDiscoveryPct(p.value)}>
                    {p.label}
                  </Button>
                ))}
              </div>
              <div className="ml-auto flex gap-5 text-sm">
                <div className="text-right">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Delivery</div>
                  <div className="text-lg font-semibold text-sky-400">{deliveryHours.toFixed(0)} h</div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Discovery</div>
                  <div className="text-lg font-semibold text-purple-400">{discoveryHours.toFixed(0)} h</div>
                </div>
              </div>
            </div>
            <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-[var(--color-ink-800)]">
              <div style={{ width: `${100 - pct}%`, backgroundColor: '#38bdf8' }} />
              <div style={{ width: `${pct}%`, backgroundColor: '#c084fc' }} />
            </div>
            <p className="mt-2 text-xs text-slate-600">
              Delivery is the team's commitment and is measured against its own share. Discovery takes
              whatever delivery leaves free.
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save capacity'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
