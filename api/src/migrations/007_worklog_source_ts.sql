-- Los exports de Tempo no traen id de worklog, pero sí la hora exacta del apunte
-- ("2026-09-01 10:00"). Guardarla permite distinguir dos apuntes de la misma
-- persona, tarea, día y duración, que sin ella parecerían el mismo.
-- Es sólo un discriminador de deduplicación: se guarda tal cual viene, sin
-- interpretar zona horaria.
alter table dedications add column if not exists source_ts text;

drop index if exists idx_dedications_fingerprint;
create index if not exists idx_dedications_fingerprint
  on dedications (task_uid, user_id, date, hours, source_ts);
