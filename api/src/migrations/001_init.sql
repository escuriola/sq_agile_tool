create extension if not exists "pgcrypto";

create table if not exists users (
  id              text primary key,
  name            text not null,
  capacity_hours  numeric,           -- horas disponibles por sprint
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

create table if not exists projects (
  id         text primary key,
  name       text not null,
  color      text,
  created_at timestamptz not null default now()
);

create table if not exists sprints (
  id         text primary key,
  name       text not null,
  start_date date,
  end_date   date,
  goal       text,
  status     text not null default 'planned',   -- planned | active | closed
  created_at timestamptz not null default now()
);

create table if not exists tasks (
  uid               uuid primary key default gen_random_uuid(),
  key               text not null,               -- id de tarea que tú escribes (EMA-123)
  sprint_id         text not null references sprints(id) on delete cascade,
  project_id        text not null references projects(id) on delete restrict,
  title             text,
  type              text not null default 'story',  -- story | bug | tech | support
  status            text not null default 'todo',   -- todo | in_progress | blocked | review | done
  estimate_points   numeric,
  estimate_hours    numeric,
  assignee_id       text references users(id) on delete set null,
  comment           text,
  added_after_start boolean not null default false, -- scope creep
  completed_at      date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (sprint_id, key)
);

create table if not exists dedications (
  id         uuid primary key default gen_random_uuid(),
  task_uid   uuid not null references tasks(uid) on delete cascade,
  user_id    text not null references users(id) on delete restrict,
  hours      numeric not null check (hours > 0),
  date       date not null default current_date,
  note       text,
  created_at timestamptz not null default now()
);

create index if not exists idx_tasks_sprint      on tasks(sprint_id);
create index if not exists idx_tasks_project     on tasks(project_id);
create index if not exists idx_dedications_task  on dedications(task_uid);
create index if not exists idx_dedications_user  on dedications(user_id);
create index if not exists idx_dedications_date  on dedications(date);

