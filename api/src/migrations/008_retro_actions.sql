-- Acciones SMART de la retrospectiva. Nacen en un sprint y se revisan en los
-- siguientes: por eso la fecha límite y el estado son lo que de verdad importa,
-- no el sprint en el que se escribieron.
create table if not exists retro_actions (
  id          uuid primary key default gen_random_uuid(),
  sprint_id   text not null references sprints(id) on delete cascade,

  -- S: qué se va a hacer, en una frase concreta
  title       text not null,
  -- M: cómo se sabrá que está hecho
  measurable  text,
  -- A: por qué es alcanzable con el equipo y el tiempo que hay
  achievable  text,
  -- R: qué problema de la retro resuelve
  relevant    text,
  -- T: fecha límite
  due_date    date,

  owner_id    text references users(id) on delete set null,
  -- pending | in_progress | done | dropped
  status      text not null default 'pending',
  -- qué pasó de verdad, se rellena al revisarla
  outcome     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_retro_actions_sprint on retro_actions (sprint_id);
create index if not exists idx_retro_actions_status on retro_actions (status);
