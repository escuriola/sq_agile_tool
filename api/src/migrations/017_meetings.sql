-- Reuniones del sprint. La primera clase es el 1:1 con cada persona, pero la
-- tabla no lo da por supuesto: `kind` deja sitio a otras sin cambiar el esquema.
--
-- Las preguntas viven en dos sitios a propósito. La plantilla es el guion vivo,
-- que se edita cuando cambia lo que quieres preguntar; cada reunión se lleva una
-- COPIA de las preguntas al crearse. Así editar la plantilla no reescribe lo que
-- ya te respondieron hace tres sprints, y puedes añadir una pregunta suelta a una
-- reunión concreta sin tocar el guion.

create table if not exists meeting_templates (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null default '1on1',
  name        text not null,
  description text,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists meeting_template_questions (
  id           uuid primary key default gen_random_uuid(),
  template_id  uuid not null references meeting_templates(id) on delete cascade,
  section      text not null,
  section_hint text,
  question     text not null,
  -- el núcleo que cabe en media hora; el resto queda como follow-up
  is_core      boolean not null default false,
  position     int not null default 0
);

create index if not exists idx_mtq_template on meeting_template_questions (template_id, position);

create table if not exists meetings (
  id          uuid primary key default gen_random_uuid(),
  sprint_id   text not null references sprints(id) on delete cascade,
  kind        text not null default '1on1',
  -- con quien. Null para reuniones que no son de una persona concreta.
  user_id     text references users(id) on delete cascade,
  template_id uuid references meeting_templates(id) on delete set null,
  held_on     date,
  -- 'draft' mientras se prepara o se toma nota, 'held' cuando ya pasó
  status      text not null default 'draft' check (status in ('draft', 'held')),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_meetings_sprint on meetings (sprint_id, kind, user_id);

create table if not exists meeting_answers (
  id           uuid primary key default gen_random_uuid(),
  meeting_id   uuid not null references meetings(id) on delete cascade,
  section      text not null,
  section_hint text,
  question     text not null,
  is_core      boolean not null default false,
  answer       text,
  position     int not null default 0
);

create index if not exists idx_meeting_answers on meeting_answers (meeting_id, position);

-- Guion de partida para el 1:1. Es solo un punto de partida: se edita desde la
-- interfaz y cada quien acaba con el suyo.
do $MIG$
declare tpl uuid;
begin
  if exists (select 1 from meeting_templates where kind = '1on1') then return; end if;

  insert into meeting_templates (kind, name, description, is_default)
  values ('1on1', 'One-to-one',
          'Around 30 minutes. Ask the core questions; keep the rest as follow-ups for when an answer opens a door.',
          true)
  returning id into tpl;

  insert into meeting_template_questions (template_id, section, section_hint, question, is_core, position)
  values
  (tpl, 'Opening / general check-in', '3–4 min', 'How are things going for you at the moment?', true, 1),
  (tpl, 'Opening / general check-in', '3–4 min', 'How are you feeling about the way the team is working together?', false, 2),
  (tpl, 'Opening / general check-in', '3–4 min', 'Is there anything that has been making your day-to-day work harder than it should be?', true, 3),
  (tpl, 'Refinements and team involvement', '8–10 min · get at participation without asking «why don''t you take part more?»', 'How do you feel about our refinement sessions at the moment?', true, 4),
  (tpl, 'Refinements and team involvement', '8–10 min · get at participation without asking «why don''t you take part more?»', 'Do you feel you have enough context before or during refinement to contribute effectively?', false, 5),
  (tpl, 'Refinements and team involvement', '8–10 min · get at participation without asking «why don''t you take part more?»', 'What makes it easier for you to participate in a refinement? And what makes it harder?', true, 6),
  (tpl, 'Refinements and team involvement', '8–10 min · get at participation without asking «why don''t you take part more?»', 'Is there anything we could change in the way we run refinements to make them more useful or engaging?', false, 7),
  (tpl, 'Refinements and team involvement', '8–10 min · get at participation without asking «why don''t you take part more?»', 'Do you think everyone feels equally comfortable challenging requirements, asking questions or proposing alternatives?', false, 8),
  (tpl, 'Refinements and team involvement', '8–10 min · get at participation without asking «why don''t you take part more?»', 'Would it help to share some topics in advance so people have time to think about them before the meeting?', false, 9),
  (tpl, 'Refinements and team involvement', '8–10 min · get at participation without asking «why don''t you take part more?»', 'Do you feel the right people are involved in the discussion, or do we sometimes spend too much time on topics that are not relevant to everyone?', false, 10),
  (tpl, 'Refinements and team involvement', '8–10 min · get at participation without asking «why don''t you take part more?»', 'What could I do as Scrum Master to help the team participate more actively in refinements?', false, 11),
  (tpl, 'Refinements and team involvement', '8–10 min · get at participation without asking «why don''t you take part more?»', 'If you could change one thing about our refinements tomorrow, what would it be?', true, 12),
  (tpl, 'Estimations', '5–6 min · avoid «are we overestimating?», which leads the answer', 'How do you feel about the way we estimate work?', true, 13),
  (tpl, 'Estimations', '5–6 min · avoid «are we overestimating?», which leads the answer', 'Do you feel comfortable with the estimates we agree on as a team?', false, 14),
  (tpl, 'Estimations', '5–6 min · avoid «are we overestimating?», which leads the answer', 'What usually creates the most uncertainty when you estimate a task?', false, 15),
  (tpl, 'Estimations', '5–6 min · avoid «are we overestimating?», which leads the answer', 'Do you think we sometimes estimate uncertainty rather than the actual implementation effort?', false, 16),
  (tpl, 'Estimations', '5–6 min · avoid «are we overestimating?», which leads the answer', 'Do you feel we have enough information at refinement time to make a reasonable estimate?', false, 17),
  (tpl, 'Estimations', '5–6 min · avoid «are we overestimating?», which leads the answer', 'Is there anything we could change to make estimates more useful without spending too much time on them?', false, 18),
  (tpl, 'Estimations', '5–6 min · avoid «are we overestimating?», which leads the answer', 'When an estimate turns out to be very different from the actual effort, what do you think is usually the reason?', true, 19),
  (tpl, 'Day-to-day / team process', '5 min', 'What is currently slowing you down the most in your day-to-day work?', false, 20),
  (tpl, 'Day-to-day / team process', '5 min', 'Is there any process, meeting or recurring task that you feel adds less value than it should?', false, 21),
  (tpl, 'Day-to-day / team process', '5 min', 'Is there anything you need more of from the team: context, technical discussion, support, ownership, feedback…?', false, 22),
  (tpl, 'Day-to-day / team process', '5 min', 'Is there anything we could change as a team that would make your work easier or more enjoyable?', true, 23),
  (tpl, 'Day-to-day / team process', '5 min', 'Are there things you think we should stop doing, start doing, or do differently?', false, 24),
  (tpl, 'Feedback for you as Scrum Master', '5 min · be concrete enough to avoid «no, everything is fine»', 'Is there anything I could do differently as Scrum Master that would help you or the team?', false, 25),
  (tpl, 'Feedback for you as Scrum Master', '5 min · be concrete enough to avoid «no, everything is fine»', 'Do you feel I give the team enough space to organise and make decisions?', false, 26),
  (tpl, 'Feedback for you as Scrum Master', '5 min · be concrete enough to avoid «no, everything is fine»', 'Are there situations where you would like me to step in more? Or less?', false, 27),
  (tpl, 'Feedback for you as Scrum Master', '5 min · be concrete enough to avoid «no, everything is fine»', 'Do you feel issues or blockers are followed up properly when you raise them?', false, 28),
  (tpl, 'Feedback for you as Scrum Master', '5 min · be concrete enough to avoid «no, everything is fine»', 'Is there anything I do that you think adds unnecessary friction?', false, 29),
  (tpl, 'Feedback for you as Scrum Master', '5 min · be concrete enough to avoid «no, everything is fine»', 'What is one thing you would like me to improve?', true, 30),
  (tpl, 'Feedback for you as Scrum Master', '5 min · be concrete enough to avoid «no, everything is fine»', 'If you were Scrum Master for the team for one month, what is the first thing you would change?', true, 31),
  (tpl, 'Closing', '2 min · always the same two, plus one for continuity', 'Is there anything we haven''t talked about that you think I should know?', true, 32),
  (tpl, 'Closing', '2 min · always the same two, plus one for continuity', 'Is there anything we discussed today that you would like me to follow up on?', false, 33),
  (tpl, 'Closing', '2 min · always the same two, plus one for continuity', 'Is there something we should check again in our next one-to-one?', false, 34);
end $MIG$;
