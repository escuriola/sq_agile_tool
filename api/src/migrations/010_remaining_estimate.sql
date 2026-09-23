-- Jira mantiene el "remaining estimate" de cada subtarea y viene en el CSV de
-- Tempo. Es la única señal de avance real que se puede importar sin tocar Jira,
-- y no depende de que nadie actualice estados a mano.
alter table tasks add column if not exists remaining_hours numeric;

-- Cuándo se refrescó por última vez desde una importación, para saber si el dato
-- es de hoy o de hace tres días.
alter table tasks add column if not exists remaining_synced_at timestamptz;
