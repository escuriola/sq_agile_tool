-- El reparto que usa el equipo ahora mismo es 80 % delivery / 20 % discovery.
-- Sólo cambia el valor por defecto de los sprints nuevos; los existentes
-- conservan el reparto que tengan guardado.
alter table sprints alter column discovery_ratio set default 0.20;
