-- Datos que sólo vienen en el export de incidencias de Jira (no en el de worklog).
-- Todos son informativos o dimensiones de análisis: ninguno pisa lo que decides tú
-- (estado propio, estimación de desarrollo, carril).
alter table tasks add column if not exists priority          text;
alter table tasks add column if not exists component         text;
alter table tasks add column if not exists epic              text;
alter table tasks add column if not exists labels            text[];
-- Estado tal cual en Jira. Se guarda sin traducir: la equivalencia con los
-- estados propios es una decisión del equipo, no del importador.
alter table tasks add column if not exists jira_status       text;
alter table tasks add column if not exists jira_created_at   date;
alter table tasks add column if not exists jira_resolved_at  date;
-- En cuántos sprints ha estado: el arrastre real, que no se puede deducir de aquí.
alter table tasks add column if not exists sprint_count      int;
alter table tasks add column if not exists sprint_names      text[];
alter table tasks add column if not exists blocked_by        text[];
-- Horas totales en Jira incluyendo UAT y análisis. No sustituye a la dedicación
-- de desarrollo: sirve para comparar una con otra.
alter table tasks add column if not exists total_time_spent  numeric;
alter table tasks add column if not exists jira_synced_at    timestamptz;

create index if not exists idx_tasks_component on tasks (sprint_id, component);
