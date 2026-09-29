import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Capacity, Meeting, MeetingAnswer, MeetingTemplate } from '../lib/types';
import { Badge, Button, Card, Empty, ErrorBanner, Field, Modal, cx } from './ui';

const today = () => new Date().toISOString().slice(0, 10);

/** Agrupa preguntas por sección conservando el orden en que vienen. */
function bySection<T extends { section: string; section_hint: string | null }>(rows: T[]) {
  const out: { section: string; hint: string | null; rows: T[] }[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last.section === r.section) last.rows.push(r);
    else out.push({ section: r.section, hint: r.section_hint, rows: [r] });
  }
  return out;
}

/* ------------------------------------------------------- el cuestionario */

function MeetingForm({
  meetingId,
  onClose,
  onSaved,
}: {
  meetingId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['meeting', meetingId],
    queryFn: () => api.meetings.get(meetingId),
  });

  const [draft, setDraft] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [heldOn, setHeldOn] = useState('');
  // Por defecto sólo el núcleo: 34 preguntas de golpe no se responden en 30 min.
  const [showAll, setShowAll] = useState(false);
  const [dirty, setDirty] = useState(false);
  // Qué reunión se volcó ya al formulario. Sin esto, cualquier refetch (por
  // ejemplo el que dispara guardar) reescribiría encima de lo que se está
  // tecleando en ese momento.
  const [hydrated, setHydrated] = useState<string | null>(null);

  useEffect(() => {
    if (!data || data.id === hydrated) return;
    setHydrated(data.id);
    const d: Record<string, string> = {};
    for (const a of data.answers ?? []) d[a.id] = a.answer ?? '';
    setDraft(d);
    setNotes(data.notes ?? '');
    setHeldOn(data.held_on ?? '');
    setDirty(false);
    // Si ya hay respuestas fuera del núcleo, enseñarlas: si no, desaparecen.
    if ((data.answers ?? []).some((a) => !a.is_core && a.answer)) setShowAll(true);
  }, [data, hydrated]);

  const save = useMutation({
    mutationFn: (status?: 'draft' | 'held') =>
      api.meetings.save(meetingId, {
        held_on: heldOn || null,
        notes: notes.trim() || null,
        status,
        answers: Object.entries(draft).map(([id, answer]) => ({ id, answer: answer.trim() || null })),
      }),
    onSuccess: () => {
      setDirty(false);
      onSaved();
    },
  });

  const answers = data?.answers ?? [];
  const visibles = showAll ? answers : answers.filter((a) => a.is_core || a.answer);
  const respondidas = answers.filter((a) => (draft[a.id] ?? '').trim()).length;
  const nucleo = answers.filter((a) => a.is_core).length;

  const set = (id: string, v: string) => {
    setDraft((p) => ({ ...p, [id]: v }));
    setDirty(true);
  };

  return (
    <Modal
      open
      onClose={() => {
        if (!dirty || confirm('There are unsaved answers. Close anyway?')) onClose();
      }}
      wide
      title={
        isLoading || !data ? (
          'Loading…'
        ) : (
          <span className="flex flex-wrap items-center gap-2">
            <span>One-to-one · {data.user_name ?? 'no one'}</span>
            <Badge color={data.status === 'held' ? '#34d399' : '#64748b'}>
              {data.status === 'held' ? 'held' : 'draft'}
            </Badge>
            <span className="text-xs font-normal text-slate-500">
              {respondidas} of {answers.length} answered
            </span>
          </span>
        )
      }
    >
      {isLoading || !data ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <div className="flex flex-col gap-4">
          <ErrorBanner error={save.error} />

          <div className="flex flex-wrap items-end gap-3">
            <Field label="Date" className="w-40">
              <input type="date" value={heldOn} onChange={(e) => { setHeldOn(e.target.value); setDirty(true); }} />
            </Field>
            <label className="flex items-center gap-2 pb-2 text-xs text-slate-400">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
              Show all {answers.length} questions
              <span className="text-slate-600">({nucleo} core by default)</span>
            </label>
          </div>

          {bySection(visibles).map((sec) => (
            <div key={sec.section} className="rounded-lg border border-[var(--color-ink-800)] p-3">
              <h4 className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                {sec.section}
              </h4>
              {sec.hint && <p className="mb-2 text-[11px] text-slate-600">{sec.hint}</p>}
              <div className="flex flex-col gap-3">
                {sec.rows.map((a: MeetingAnswer) => (
                  <div key={a.id}>
                    <label className="flex items-start gap-1.5 text-sm text-slate-300">
                      {a.is_core && <span className="text-amber-400" title="Core question">★</span>}
                      <span>{a.question}</span>
                    </label>
                    <textarea
                      rows={2}
                      className="mt-1 w-full"
                      value={draft[a.id] ?? ''}
                      onChange={(e) => set(a.id, e.target.value)}
                      placeholder="…"
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}

          <Field label="Your own notes" hint="not a question you asked — what you took away from it">
            <textarea rows={3} value={notes} onChange={(e) => { setNotes(e.target.value); setDirty(true); }} />
          </Field>

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button type="button" onClick={() => save.mutate(undefined)} disabled={save.isPending}>
              Save draft
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={save.isPending}
              onClick={() => save.mutate('held')}
            >
              Save and mark as held
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ----------------------------------------------------- editor del guion */

function TemplateEditor({ template, onClose }: { template: MeetingTemplate; onClose: () => void }) {
  const qc = useQueryClient();
  const [rows, setRows] = useState(
    template.questions.map((q) => ({
      section: q.section,
      section_hint: q.section_hint,
      question: q.question,
      is_core: q.is_core,
    }))
  );

  const save = useMutation({
    mutationFn: () => api.meetings.saveTemplate(template.id, { questions: rows }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meetingTemplates'] });
      onClose();
    },
  });

  const upd = (i: number, patch: Partial<(typeof rows)[number]>) =>
    setRows((p) => p.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  return (
    <Modal open onClose={onClose} wide title="Question script for one-to-ones">
      <div className="flex flex-col gap-3">
        <ErrorBanner error={save.error} />
        <p className="text-xs text-slate-500">
          This is the starting point for new meetings. Editing it never changes a meeting you have
          already held: each one keeps its own copy of the questions as they were asked.
        </p>

        <div className="max-h-[52vh] overflow-y-auto rounded-lg border border-[var(--color-ink-800)]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-[var(--color-ink-900)] text-left text-slate-500">
              <tr>
                <th className="p-2">Section</th>
                <th className="p-2">Question</th>
                <th className="p-2 text-center" title="Part of the ~30 minute core">★</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-ink-800)]">
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="p-1.5 align-top">
                    <input
                      className="w-40 text-xs"
                      value={r.section}
                      onChange={(e) => upd(i, { section: e.target.value })}
                    />
                  </td>
                  <td className="p-1.5">
                    <textarea
                      rows={2}
                      className="w-full text-xs"
                      value={r.question}
                      onChange={(e) => upd(i, { question: e.target.value })}
                    />
                  </td>
                  <td className="p-1.5 text-center align-top">
                    <input
                      type="checkbox"
                      checked={r.is_core}
                      onChange={(e) => upd(i, { is_core: e.target.checked })}
                    />
                  </td>
                  <td className="p-1.5 align-top">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-rose-400"
                      onClick={() => setRows((p) => p.filter((_, idx) => idx !== i))}
                    >
                      ✕
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap justify-between gap-2">
          <Button
            size="sm"
            onClick={() =>
              setRows((p) => [
                ...p,
                { section: p[p.length - 1]?.section ?? 'Closing', section_hint: null, question: '', is_core: false },
              ])
            }
          >
            + Add question
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={save.isPending || rows.some((r) => !r.question.trim() || !r.section.trim())}
              onClick={() => save.mutate()}
            >
              Save script
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------- la pestaña */

export function SprintMeetings({
  sprintId,
  capacities,
}: {
  sprintId: string;
  capacities: Capacity[];
}) {
  const qc = useQueryClient();
  const meetings = useQuery({
    queryKey: ['meetings', sprintId],
    queryFn: () => api.meetings.forSprint(sprintId),
  });
  const templates = useQuery({ queryKey: ['meetingTemplates'], queryFn: api.meetings.templates });

  const [openId, setOpenId] = useState<string | null>(null);
  const [editTpl, setEditTpl] = useState(false);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['meetings', sprintId] });
    if (openId) qc.invalidateQueries({ queryKey: ['meeting', openId] });
  };

  const create = useMutation({
    mutationFn: (userId: string) =>
      api.meetings.create(sprintId, { kind: '1on1', user_id: userId, held_on: today() }),
    onSuccess: (m) => {
      refresh();
      setOpenId(m.id);
    },
  });

  const remove = useMutation({ mutationFn: api.meetings.remove, onSuccess: refresh });

  const porPersona = new Map<string, Meeting>();
  for (const m of meetings.data?.own ?? []) if (m.user_id) porPersona.set(m.user_id, m);

  /**
   * Aquí va todo el mundo, no sólo quien tiene horas en el sprint: un 1:1 es con
   * una persona, no con una asignación de capacidad. Quien hace UAT o análisis no
   * consume capacidad de desarrollo a propósito, y aun así tienes que hablar con
   * ella. Quien ya no esté activo sólo aparece si tiene una reunión, para no
   * dejarla inalcanzable.
   */
  const equipo = useMemo(
    () =>
      capacities
        .filter((c) => c.active || porPersona.has(c.user_id))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [capacities, meetings.data]
  );

  const anterior = new Map((meetings.data?.previous ?? []).map((p) => [p.user_id, p]));

  const hechas = equipo.filter((c) => porPersona.get(c.user_id)?.status === 'held').length;
  const tpl = templates.data?.[0];

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <Card
        title="One-to-ones"
        actions={
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500">
              {hechas} of {equipo.length} held
            </span>
            {tpl && (
              <Button size="sm" variant="ghost" onClick={() => setEditTpl(true)}>
                Edit script
              </Button>
            )}
          </div>
        }
      >
        <ErrorBanner error={create.error ?? remove.error} />

        {equipo.length === 0 ? (
          <Empty>No active people yet. Add them on the Users page.</Empty>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {equipo.map((c) => {
              const m = porPersona.get(c.user_id);
              const prev = anterior.get(c.user_id);
              return (
                <li
                  key={c.user_id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-ink-800)] bg-[var(--color-ink-850)]/40 px-3 py-2"
                >
                  <span className="min-w-32 text-sm text-slate-200">{c.name}</span>

                  {m ? (
                    <>
                      <Badge color={m.status === 'held' ? '#34d399' : '#64748b'}>
                        {m.status === 'held' ? 'held' : 'draft'}
                      </Badge>
                      <span className="text-xs text-slate-500">
                        {m.answered ?? 0} of {m.questions ?? 0} answered
                      </span>
                      {m.held_on && <span className="text-xs text-slate-600">{m.held_on}</span>}
                    </>
                  ) : (
                    <span className="text-xs text-slate-600">not started</span>
                  )}

                  {prev && (
                    <button
                      onClick={() => setOpenId(prev.id)}
                      className="text-[11px] text-slate-500 underline-offset-2 hover:text-sky-300 hover:underline"
                      title="What they told you last time"
                    >
                      last: {prev.sprint_name}
                    </button>
                  )}

                  <div className="ml-auto flex items-center gap-1">
                    {m ? (
                      <>
                        <Button size="sm" onClick={() => setOpenId(m.id)}>
                          Open
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-rose-400"
                          onClick={() => confirm(`Delete the 1:1 with ${c.name}?`) && remove.mutate(m.id)}
                        >
                          ✕
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={create.isPending}
                        onClick={() => create.mutate(c.user_id)}
                      >
                        Start 1:1
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-3 text-xs text-slate-600">
          Each meeting takes its own copy of the questions, so you can change the script whenever you
          like without rewriting what people already told you.
        </p>
      </Card>

      {openId && (
        <MeetingForm meetingId={openId} onClose={() => setOpenId(null)} onSaved={refresh} />
      )}
      {editTpl && tpl && <TemplateEditor template={tpl} onClose={() => setEditTpl(false)} />}
    </div>
  );
}
