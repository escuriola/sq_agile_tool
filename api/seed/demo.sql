-- Datos de demostración: un equipo inventado con tres sprints, para poder ver
-- la herramienta llena sin tener que meter nada a mano.
--
-- Las fechas se calculan a partir de hoy, así que el sprint activo siempre está
-- a medias y el burndown tiene sentido sea cual sea el día que lo cargues.
--
-- Cárgalo con `make demo`, que levanta una instancia aparte en otros puertos y
-- con su propio volumen. Nunca toca tus datos reales.

begin;

-- ---------------------------------------------------------------- proyectos
insert into projects (id, name, color) values
  ('WEB',    'Storefront',   '#38bdf8'),
  ('API',    'Platform API', '#a78bfa'),
  ('MOBILE', 'Mobile app',   '#34d399')
on conflict (id) do nothing;

-- ---------------------------------------------------------------- personas
insert into users (id, name, capacity_hours, active) values
  ('ana',   'Ana Ferrer',    60, true),
  ('bruno', 'Bruno Costa',   60, true),
  ('chen',  'Chen Wei',      60, true),
  ('dara',  'Dara O''Neill', 60, true),
  ('eli',   'Eli Novak',     60, true),
  ('farid', 'Farid Haddad',  60, true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------- sprints
-- Lunes de esta semana como ancla. El sprint activo empezó el lunes pasado.
with anchor as (select date_trunc('week', current_date)::date as wk0)
insert into sprints (id, name, start_date, end_date, goal, status, discovery_ratio, commit_factor)
select * from (
  select 'DEMO-1' as id, 'Sprint 1 · Checkout'  as name,
         wk0 - 35 as start_date, wk0 - 24 as end_date,
         'Get the new checkout to production' as goal,
         'closed' as status, 0.20 as discovery_ratio, 1.0 as commit_factor from anchor
  union all
  select 'DEMO-2', 'Sprint 2 · Payments',
         wk0 - 21, wk0 - 10,
         'Support a second payment provider',
         'closed', 0.20, 1.0 from anchor
  union all
  select 'DEMO-3', 'Sprint 3 · Accounts',
         wk0 - 7, wk0 + 4,
         'Self-service account management',
         'active', 0.20, 0.9 from anchor
) s
on conflict (id) do nothing;

-- ---------------------------------------------------------------- capacidad
-- Horas por persona y sprint, ya descontadas las ceremonias.
insert into sprint_capacities (sprint_id, user_id, capacity_hours, note)
select s.id, u.id,
       case
         when s.id = 'DEMO-3' and u.id = 'farid' then 30   -- media jornada
         when s.id = 'DEMO-3' and u.id = 'eli'   then 44   -- vacaciones
         else 60
       end,
       case
         when s.id = 'DEMO-3' and u.id = 'farid' then 'Half time on support duty'
         when s.id = 'DEMO-3' and u.id = 'eli'   then 'Two days off'
       end
  from sprints s
  cross join users u
 where s.id like 'DEMO-%'
on conflict (sprint_id, user_id) do nothing;

-- ---------------------------------------------------------------- tareas
insert into tasks (key, sprint_id, project_id, title, type, track, status,
                   estimate_hours, assignee_id, blocked, added_after_start, comment)
values
  -- Sprint 1 (cerrado)
  ('WEB-101',  'DEMO-1', 'WEB',    'Cart summary redesign',            'story',   'delivery', 'done', 16, 'ana',   false, false, null),
  ('WEB-102',  'DEMO-1', 'WEB',    'Guest checkout',                   'story',   'delivery', 'done', 24, 'bruno', false, false, null),
  ('API-140',  'DEMO-1', 'API',    'Order validation endpoint',        'story',   'delivery', 'done', 20, 'chen',  false, false, null),
  ('API-141',  'DEMO-1', 'API',    'Stale cart cleanup job',           'tech',    'delivery', 'done',  8, 'dara',  false, false, null),
  ('WEB-103',  'DEMO-1', 'WEB',    'Discount code not applied',        'bug',     'delivery', 'done',  6, 'ana',   false, true,  'Reported by support mid-sprint'),
  ('MOB-088',  'DEMO-1', 'MOBILE', 'Checkout screen on small phones',  'bug',     'delivery', 'done', 10, 'eli',   false, false, null),
  ('API-142',  'DEMO-1', 'API',    'Payment provider spike',           'tech',    'discovery','done', 12, 'farid', false, false, null),
  ('WEB-104',  'DEMO-1', 'WEB',    'Address autocomplete',             'story',   'delivery', 'todo', 16, 'bruno', false, false, 'Dropped, moved to next sprint'),

  -- Sprint 2 (cerrado)
  ('API-150',  'DEMO-2', 'API',    'Provider abstraction layer',       'story',   'delivery', 'done', 24, 'chen',  false, false, null),
  ('API-151',  'DEMO-2', 'API',    'Refund flow',                      'story',   'delivery', 'done', 20, 'dara',  false, false, null),
  ('WEB-110',  'DEMO-2', 'WEB',    'Payment method picker',            'story',   'delivery', 'done', 16, 'ana',   false, false, null),
  ('WEB-111',  'DEMO-2', 'WEB',    'Address autocomplete',             'story',   'delivery', 'done', 16, 'bruno', false, false, 'Carried over from Sprint 1'),
  ('MOB-095',  'DEMO-2', 'MOBILE', 'Apple Pay button',                 'story',   'delivery', 'done', 18, 'eli',   false, false, null),
  ('API-152',  'DEMO-2', 'API',    'Webhook retries',                  'tech',    'delivery', 'done', 10, 'farid', false, false, null),
  ('API-153',  'DEMO-2', 'API',    'Duplicate charge on timeout',      'bug',     'delivery', 'done',  8, 'chen',  false, true,  'Escalated by the client'),
  ('WEB-112',  'DEMO-2', 'WEB',    'Saved cards UI',                   'story',   'delivery', 'uat',  14, 'ana',   false, false, null),
  ('MOB-096',  'DEMO-2', 'MOBILE', 'Payment error copy review',        'story',   'discovery','done',  6, 'dara',  false, false, null),

  -- Sprint 3 (en curso)
  ('WEB-120',  'DEMO-3', 'WEB',    'Profile page',                     'story',   'delivery', 'done',       16, 'ana',   false, false, null),
  ('WEB-121',  'DEMO-3', 'WEB',    'Change email with confirmation',   'story',   'delivery', 'peer_review',20, 'ana',   false, false, null),
  ('WEB-122',  'DEMO-3', 'WEB',    'Delete account',                   'story',   'delivery', 'in_progress',24, 'bruno', false, false, 'Needs a legal review before release'),
  ('API-160',  'DEMO-3', 'API',    'Account settings endpoints',       'story',   'delivery', 'done',       20, 'chen',  false, false, null),
  ('API-161',  'DEMO-3', 'API',    'Password reset rate limiting',     'tech',    'delivery', 'ready_acc',  12, 'chen',  false, false, null),
  ('API-162',  'DEMO-3', 'API',    'GDPR export job',                  'story',   'delivery', 'in_progress',24, 'dara',  true,  false, 'Blocked: waiting for the storage bucket'),
  ('API-163',  'DEMO-3', 'API',    'Session token leak in logs',       'bug',     'delivery', 'done',        6, 'dara',  false, true,  'Found by the security scan'),
  ('MOB-110',  'DEMO-3', 'MOBILE', 'Account screen',                   'story',   'delivery', 'in_progress',20, 'eli',   false, false, null),
  ('MOB-111',  'DEMO-3', 'MOBILE', 'Biometric login',                  'story',   'delivery', 'todo',       16, 'eli',   false, false, null),
  ('API-164',  'DEMO-3', 'API',    'On-call handover notes',           'support', 'delivery', 'done',        4, 'farid', false, false, null),
  ('API-165',  'DEMO-3', 'API',    'Notifications service spike',      'tech',    'discovery','in_progress',12, 'farid', false, false, null),
  ('WEB-123',  'DEMO-3', 'WEB',    'Avatar upload',                    'story',   'delivery', 'todo',       10, null,    false, false, null),
  ('WEB-124',  'DEMO-3', 'WEB',    'Accessibility pass on forms',      'tech',    'delivery', 'todo',     null, null,    false, false, 'Not estimated yet'),
  ('MOB-112',  'DEMO-3', 'MOBILE', 'Push permission prompt timing',    'story',   'discovery','todo',        8, null,    false, false, null)
on conflict do nothing;

-- Este equipo de mentira estima sólo en horas, como la mayoría: así la demo
-- enseña el comportamiento por defecto del panel, que cae a horas cuando no hay
-- puntos. Si tu equipo usa puntos, rellena estimate_points y el panel los usa.

-- Fecha de cierre repartida por el sprint, para que el burndown baje poco a poco
-- en vez de desplomarse el último día.
update tasks t
   set completed_at = s.start_date + ((abs(hashtext(t.key)) % greatest(1, (least(current_date, s.end_date) - s.start_date))))
  from sprints s
 where s.id = t.sprint_id
   and t.sprint_id like 'DEMO-%'
   and t.status = 'done'
   and t.completed_at is null;

-- Los fines de semana se mueven al viernes anterior: nadie cierra tareas en sábado.
update tasks set completed_at = completed_at - (extract(isodow from completed_at)::int - 5)
 where sprint_id like 'DEMO-%' and completed_at is not null
   and extract(isodow from completed_at) > 5;

-- ---------------------------------------------------------------- imputaciones
-- Reparte las horas de cada tarea por los días laborables de su ventana: desde
-- que se empezó hasta que se cerró, o hasta hoy si sigue abierta. Repartir por
-- toda la ventana (y no en días seguidos) es lo que hace que el burndown baje
-- de forma creíble y que haya imputaciones hasta el día de hoy.
do $$
declare
  t        record;
  ini      date;
  fin      date;
  dia      date;
  total    numeric;
  trozo    numeric;
  semilla  int;
  paso     int;
  ndias    int;
begin
  for t in
    select tk.uid, tk.key, tk.assignee_id, tk.estimate_hours, tk.status,
           tk.completed_at, s.start_date, s.end_date
      from tasks tk
      join sprints s on s.id = tk.sprint_id
     where tk.sprint_id like 'DEMO-%'
       and tk.assignee_id is not null
       and tk.estimate_hours is not null
       and tk.estimate_hours > 0
       and tk.status <> 'todo'
       -- Idempotencia: si la tarea ya tiene imputaciones, no se vuelve a sembrar.
       and not exists (select 1 from dedications d where d.task_uid = tk.uid)
  loop
    semilla := abs(hashtext(t.key));

    -- Cerradas: entre el 80% y el 140% de lo estimado, que es la desviación que
    -- se ve en la vida real. En curso: entre el 30% y el 80%.
    total := round(t.estimate_hours * (
               case when t.status = 'done'
                    then 0.8 + (semilla % 60) / 100.0
                    else 0.3 + (semilla % 50) / 100.0
               end), 2);

    ini := t.start_date + (semilla % 3);
    fin := coalesce(t.completed_at, least(current_date, t.end_date));
    if fin < ini then fin := ini; end if;

    -- Días laborables de la ventana, para saber cuánto toca por día.
    select count(*) into ndias
      from generate_series(ini, fin, interval '1 day') d
     where extract(isodow from d) <= 5;
    if ndias = 0 then continue; end if;

    dia  := ini;
    paso := 0;
    while dia <= fin and total > 0 loop
      if extract(isodow from dia) <= 5 then
        -- Reparto desigual alrededor de la media, redondeado al cuarto de hora.
        trozo := round((total / greatest(1, ndias - paso))
                       * (0.7 + ((semilla + paso * 37) % 70) / 100.0) * 4) / 4;
        trozo := least(greatest(trozo, 0.5), total);
        insert into dedications (task_uid, user_id, hours, date, note, source)
        values (t.uid, t.assignee_id, trozo, dia,
                case when paso = 0 then 'Started ' || t.key else null end, 'manual');
        total := total - trozo;
        paso  := paso + 1;
      end if;
      dia := dia + 1;
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------- retro
insert into retro_actions (sprint_id, title, measurable, achievable, relevant, due_date, owner_id, status, outcome)
with anchor as (select date_trunc('week', current_date)::date as wk0)
select * from (
  select 'DEMO-2' as sprint_id,
         'Estimate every task before it enters the sprint' as title,
         'No task starts the sprint without an estimate in hours' as measurable,
         'Thirty minutes at the end of refinement' as achievable,
         'Last sprint four tasks went in unestimated and we overcommitted' as relevant,
         wk0 - 10 as due_date, 'chen' as owner_id, 'done' as status,
         'Done for Sprint 3 except one task' as outcome from anchor
  union all
  -- Sigue abierta y con la fecha pasada: aparece arrastrada en el sprint actual
  -- y marcada como vencida, que es justo lo que hay que ver en la retro.
  select 'DEMO-2',
         'Write the acceptance criteria before estimating',
         'Every story has acceptance criteria when it reaches refinement',
         'The product owner already drafts them, they just arrive late',
         'Two tasks were re-estimated mid-sprint because the scope was unclear',
         wk0 - 10, 'ana', 'pending', null from anchor
  union all
  select 'DEMO-3',
         'Raise blockers in the daily, not in the retro',
         'Every blocked task is flagged the same day it blocks',
         'It costs nothing, it is a habit',
         'The GDPR export sat blocked for four days before anyone said so',
         wk0 + 4, 'dara', 'in_progress', null from anchor
  union all
  select 'DEMO-3',
         'Split stories larger than 16 hours',
         'No task in the next sprint is estimated above 16 h',
         'We already do it for the API, extend it to the rest',
         'The two largest tasks are the ones that slipped',
         wk0 + 4, null, 'pending', null from anchor
) r
where not exists (select 1 from retro_actions x
                   where x.sprint_id = r.sprint_id and x.title = r.title);

-- ---------------------------------------------------------------- mis tareas
insert into sprint_todos (sprint_id, title, notes, done, due_date, position)
with anchor as (select date_trunc('week', current_date)::date as wk0)
select * from (
  select 'DEMO-3' as sprint_id, 'Book the retro room' as title, null as notes,
         true as done, null::date as due_date, 0 as position from anchor
  union all
  select 'DEMO-3', 'Chase the storage bucket for the GDPR export',
         'Blocking API-162 since Tuesday', false, wk0 + 1, 1 from anchor
  union all
  select 'DEMO-3', 'Prepare the capacity numbers for next sprint',
         null, false, wk0 + 3, 2 from anchor
) td
where not exists (select 1 from sprint_todos x
                   where x.sprint_id = td.sprint_id and x.title = td.title);

commit;
