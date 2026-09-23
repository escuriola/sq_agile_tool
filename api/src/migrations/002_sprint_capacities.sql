-- La capacidad real varía en cada sprint (vacaciones, bajas, dedicación parcial).
-- users.capacity_hours pasa a ser sólo el valor por defecto que se propone;
-- el valor que manda en las métricas es el de esta tabla.
create table if not exists sprint_capacities (
  sprint_id      text not null references sprints(id) on delete cascade,
  user_id        text not null references users(id) on delete cascade,
  capacity_hours numeric not null default 0 check (capacity_hours >= 0),
  note           text,
  updated_at     timestamptz not null default now(),
  primary key (sprint_id, user_id)
);

create index if not exists idx_sprint_capacities_sprint on sprint_capacities(sprint_id);

-- Los sprints que ya existan heredan la capacidad por defecto de cada usuario activo,
-- para que las métricas ya calculadas no cambien de golpe.
insert into sprint_capacities (sprint_id, user_id, capacity_hours)
select s.id, u.id, u.capacity_hours
from sprints s
cross join users u
where u.active and u.capacity_hours is not null
on conflict (sprint_id, user_id) do nothing;
