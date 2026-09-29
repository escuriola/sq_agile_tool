-- Las conclusiones que sacas al leer los 1:1 de un sprint juntos. No son las
-- notas de una reunión concreta (eso ya vive en meetings.notes) ni acciones
-- SMART de retro: son el paso intermedio, lo que ves al comparar lo que te ha
-- dicho todo el mundo, y de donde luego salen las acciones.
alter table sprints
  add column if not exists meeting_notes text;

comment on column sprints.meeting_notes is
  'Conclusiones del Scrum Master tras leer juntos los 1:1 del sprint.';
