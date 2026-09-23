-- 0.3333 dejaba restos feos (384,02 h en vez de 384 h). Un tercio exacto.
alter table sprints alter column discovery_ratio set default 0.333333;

update sprints set discovery_ratio = 0.333333 where discovery_ratio = 0.3333;
