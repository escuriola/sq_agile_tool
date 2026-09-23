-- Parte de la capacidad del sprint se reserva para discovery (por defecto 1/3).
-- El delivery es el commitment del equipo; el discovery ocupa lo que quede.
alter table sprints add column if not exists discovery_ratio numeric not null default 0.3333;
alter table sprints add constraint sprints_discovery_ratio_chk
  check (discovery_ratio >= 0 and discovery_ratio <= 1);

-- Carril de la tarea. Es ortogonal al tipo (historia/bug/técnica/soporte):
-- una tarea de discovery puede ser una historia o una spike técnica.
alter table tasks add column if not exists track text not null default 'delivery';
alter table tasks add constraint tasks_track_chk check (track in ('delivery', 'discovery'));

create index if not exists idx_tasks_track on tasks(sprint_id, track);
