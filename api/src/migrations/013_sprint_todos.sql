-- Lista personal del Scrum Master: administración y gestión del sprint.
-- Deliberadamente FUERA de la tabla tasks: no son trabajo del equipo, no se
-- estiman en horas del sprint, no consumen capacidad, no tienen carril ni se
-- sincronizan con Jira. Meterlas ahí falsearía todas las métricas.
create table if not exists sprint_todos (
  id         uuid primary key default gen_random_uuid(),
  sprint_id  text not null references sprints(id) on delete cascade,
  title      text not null,
  notes      text,
  done       boolean not null default false,
  due_date   date,
  -- orden manual dentro de la lista
  position   int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  done_at    timestamptz
);

create index if not exists idx_sprint_todos_sprint on sprint_todos (sprint_id, position, created_at);
