-- Equivalencia entre los estados de Jira y los del tablero. Se configura una vez
-- y a partir de ahí cada importación de incidencias mueve las tareas sola.
-- Es una tabla y no una constante porque el flujo de Jira cambia con el tiempo
-- y cada equipo tiene el suyo.
create table if not exists status_mappings (
  jira_status text primary key,
  app_status  text not null,
  updated_at  timestamptz not null default now()
);
