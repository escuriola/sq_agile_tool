-- Estados reales del flujo del equipo. "Bloqueada" deja de ser un estado y pasa
-- a ser un flag: una tarea bloqueada sigue estando en algún punto del flujo, y
-- mezclarlo perdía esa información.
alter table tasks add column if not exists blocked boolean not null default false;

-- Lo que estaba en 'blocked' no sabemos dónde estaba realmente; lo más cercano
-- es 'in_progress' con el flag puesto.
update tasks set blocked = true, status = 'in_progress' where status = 'blocked';

-- 'review' era el equivalente antiguo de la revisión entre pares.
update tasks set status = 'peer_review' where status = 'review';

-- Cualquier estado que no esté en el flujo nuevo vuelve al principio.
update tasks set status = 'todo'
where status not in ('todo', 'in_progress', 'peer_review', 'ready_ephemeral',
                     'ready_acc', 'uat', 'done');

alter table tasks add constraint tasks_status_chk check (
  status in ('todo', 'in_progress', 'peer_review', 'ready_ephemeral',
             'ready_acc', 'uat', 'done')
);

create index if not exists idx_tasks_blocked on tasks (sprint_id) where blocked;
