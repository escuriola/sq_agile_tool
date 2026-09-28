-- Separar el coste de la revisión del coste del desarrollo.
--
-- El problema: al asignar una tarea, su estimación entera se le carga al owner.
-- Pero la estimación cubre desarrollo Y revisión, y la revisión la hace otra
-- persona. Medido sobre 34 tareas cerradas: de cada hora estimada, 0,53 h son
-- desarrollo y el resto se reparte entre revisión y sobreestimación. Cargarle
-- al owner el 100% infla su carga y deja el trabajo del revisor invisible.
--
-- Igual que discovery_ratio, es una reserva por sprint y se ajusta cuando la
-- medición del sprint anterior diga otra cosa.
alter table sprints
  add column if not exists review_ratio numeric not null default 0.30;

comment on column sprints.review_ratio is
  'Parte de la estimación de una tarea que se lleva la revisión, hecha por alguien distinto del owner (0-1).';

-- Trabajo que consume capacidad pero no es desarrollo comprometible: la tarea
-- de deployments de cada proyecto, que además no se cierra hasta el último día
-- y por eso distorsiona el burndown si se cuenta como una tarea normal.
alter table tasks
  add column if not exists overhead boolean not null default false;

comment on column tasks.overhead is
  'Reserva fija del sprint (deployments, releases): consume capacidad, no cuenta como compromiso de desarrollo ni entra en el burndown.';

-- Las que ya existen se reconocen por el título. Sólo se hace una vez; a partir
-- de aquí la marca se pone a mano al crear la tarea.
update tasks
   set overhead = true
 where not overhead
   and title ~* '(deployment|deploys|release)'
   and title ~* 'sprint';

create index if not exists idx_tasks_overhead on tasks (sprint_id) where overhead;
