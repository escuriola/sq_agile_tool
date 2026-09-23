-- Factor de confianza para dimensionar el compromiso del siguiente sprint a
-- partir de la velocidad real de éste. 1.0 = comprometer exactamente lo que se
-- entregó; por debajo, ir sobre seguro; por encima, apretar a propósito.
alter table sprints add column if not exists commit_factor numeric not null default 1.0;
alter table sprints add constraint sprints_commit_factor_chk
  check (commit_factor > 0 and commit_factor <= 3);
