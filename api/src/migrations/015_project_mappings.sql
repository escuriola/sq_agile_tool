-- Equivalencia entre la clave de proyecto de Jira y el proyecto del tablero.
-- Hace falta para poder crear tareas que aún no existen a partir del CSV de
-- incidencias: "D8EMA" -> "EMA".
create table if not exists project_mappings (
  jira_project text primary key,
  project_id   text not null references projects(id) on delete cascade,
  updated_at   timestamptz not null default now()
);
