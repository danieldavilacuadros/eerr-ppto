-- 008 · Cuentas activas para el presupuesto, por unidad de negocio y por vista
-- Una vista de presupuesto es un centro (sede · unidad · marca). Cada unidad de negocio tiene una LISTA de cuentas que
-- se presupuestan en todas sus vistas; una vista puede agregar o quitar cuentas de esa lista (excepciones).
-- Cuentas de una vista = lista de su unidad + agregadas en la vista − quitadas en la vista.
-- Si una unidad no tiene lista, la grilla muestra todas las cuentas del mapa (comportamiento anterior).
-- Ejecutar una sola vez en Supabase › SQL Editor (después de 007).

create table if not exists unidad_cuentas (
  unidad text not null references unidades_negocio(codigo),
  cuenta text not null references cuentas(cuenta) on update cascade,
  primary key (unidad, cuenta)
);

create table if not exists vista_cuentas (
  sede    text not null,
  unidad  text not null,
  linea   text not null,
  cuenta  text not null references cuentas(cuenta) on update cascade,
  incluir boolean not null,            -- true = se agrega a la lista de la unidad; false = se quita
  primary key (sede, unidad, linea, cuenta),
  foreign key (sede, unidad, linea) references centros(sede, unidad, linea) on delete cascade
);

alter table unidad_cuentas enable row level security;
alter table vista_cuentas  enable row level security;

drop policy if exists unidad_cuentas_sel on unidad_cuentas;
create policy unidad_cuentas_sel on unidad_cuentas for select to authenticated using (true);
drop policy if exists unidad_cuentas_mod on unidad_cuentas;
create policy unidad_cuentas_mod on unidad_cuentas for all to authenticated
  using ((select public.es_rol(array['admin', 'contabilidad'])))
  with check ((select public.es_rol(array['admin', 'contabilidad'])));

drop policy if exists vista_cuentas_sel on vista_cuentas;
create policy vista_cuentas_sel on vista_cuentas for select to authenticated using (true);
drop policy if exists vista_cuentas_mod on vista_cuentas;
create policy vista_cuentas_mod on vista_cuentas for all to authenticated
  using ((select public.es_rol(array['admin', 'contabilidad'])))
  with check ((select public.es_rol(array['admin', 'contabilidad'])));

-- Lista inicial de cada unidad: las cuentas (no estadísticas, activas) con movimiento en SAP en el Real 2026
insert into unidad_cuentas (unidad, cuenta)
select distinct r.unidad, r.cuenta
  from real_montos r
  join escenarios e on e.id = r.escenario_id and e.tipo = 'real' and e.anio = 2026
  join cuentas c on c.cuenta = r.cuenta and c.activa and not c.es_estadistica
on conflict do nothing;

-- control
select unidad, count(*) cuentas from unidad_cuentas group by unidad order by unidad;
