-- Trazabilidad de las dedicaciones importadas desde Jira.
alter table dedications add column if not exists external_id text;
alter table dedications add column if not exists source text not null default 'manual';

-- Si el export trae el id de worklog, la deduplicación es exacta y la garantiza la BD.
create unique index if not exists uniq_dedications_external_id
  on dedications (external_id) where external_id is not null;

-- Sin id externo se deduplica contando (tarea, persona, fecha, horas); este índice
-- hace ese recuento barato.
create index if not exists idx_dedications_fingerprint
  on dedications (task_uid, user_id, date, hours);
