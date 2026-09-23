-- De dónde viene la estimación, para respetar la prioridad del equipo:
--   dev_subtask  > parent > (preguntar)
-- y que lo escrito a mano no lo pise nunca ninguna importación.
--   manual       lo ha escrito una persona
--   dev_subtask  estimación de la subtarea DEV (llega por el CSV de worklog)
--   parent       estimación propia de la tarea (llega por el CSV de incidencias)
alter table tasks add column if not exists estimate_source text;

-- Lo que ya existe se marca como manual: es la opción conservadora, porque no se
-- puede distinguir a posteriori qué se tecleó y qué vino del worklog, y así
-- ninguna importación futura lo sobrescribe.
update tasks set estimate_source = 'manual'
where estimate_hours is not null and estimate_source is null;
