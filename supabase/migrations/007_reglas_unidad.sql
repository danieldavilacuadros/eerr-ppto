-- 007 · Reglas de unidad de negocio para los reportes
-- SAP registra algunos rubros en una unidad que no es la del negocio (ej. la compra de GPS y MOK en Venta de unidades,
-- cuando su venta está en Equipamiento y accesorios). Una regla hace que, en los reportes, las cuentas de ese rubro
-- registradas en la unidad de origen se muestren en la unidad de destino, con la misma sede y marca.
-- SAP (real_montos) no se modifica; el total de la empresa no cambia.
-- Ejecutar una sola vez en Supabase › SQL Editor (después de 006).

create table if not exists reglas_unidad (
  rubro          text not null references rubros_eerr(codigo) on update cascade,
  unidad_origen  text not null references unidades_negocio(codigo),
  unidad_destino text not null references unidades_negocio(codigo),
  activo         boolean not null default true,
  primary key (rubro, unidad_origen)
);

alter table reglas_unidad enable row level security;
drop policy if exists reglas_unidad_sel on reglas_unidad;
create policy reglas_unidad_sel on reglas_unidad for select to authenticated using (true);
drop policy if exists reglas_unidad_mod on reglas_unidad;
create policy reglas_unidad_mod on reglas_unidad for all to authenticated
  using (public.es_rol(array['admin', 'contabilidad']))
  with check (public.es_rol(array['admin', 'contabilidad']));

-- GPS, MOK y GLP registrados en Venta de unidades → Equipamiento y accesorios (pedido de Daniel, 09/11/2026)
insert into reglas_unidad (rubro, unidad_origen, unidad_destino) values
  ('GPS +', 'UNI', 'ACC'), ('GPS -', 'UNI', 'ACC'),
  ('MOK +', 'UNI', 'ACC'), ('MOK -', 'UNI', 'ACC'),
  ('GLP +', 'UNI', 'ACC'), ('GLP -', 'UNI', 'ACC')
on conflict (rubro, unidad_origen) do nothing;

-- Reportes por fuente con las reglas aplicadas. Es security definer para poder mover filas de unidad ANTES de
-- revisar el acceso: cada usuario ve lo que corresponde a su alcance según la unidad ya corregida
-- (ej. un jefe de Equipamiento ve la compra de GPS que SAP registró en Venta de unidades).
create or replace function public.resumen_montos_fuente(p_escenarios bigint[])
returns table (escenario_id bigint, anio int, mes int, sede text, unidad text, linea text, cuenta text, fuente text, monto numeric)
language sql stable security definer set search_path = public as $$
  with base as (
    select r.escenario_id, r.anio, r.mes, r.sede, r.unidad, r.linea, r.cuenta, 'SAP' fuente, r.monto
      from real_montos r where r.escenario_id = any(p_escenarios)
    union all
    select e.escenario_id, e.anio, e.mes, e.sede, e.unidad, e.linea, e.cuenta, 'EXTRA', e.monto
      from extra_libros e where e.escenario_id = any(p_escenarios)
    union all
    select a.escenario_id, a.anio, a.mes, l.sede, l.unidad, l.linea, l.cuenta, 'EXTRA', l.monto
      from ajustes a join ajuste_lineas l on l.ajuste_id = a.id
     where a.estado = 'aplicado' and a.escenario_id = any(p_escenarios)
    union all
    select p.escenario_id, p.anio, p.mes, p.sede, p.unidad, p.linea, p.cuenta, 'PPTO', p.monto
      from ppto_montos p where p.escenario_id = any(p_escenarios)
  ),
  movido as (
    select b.escenario_id, b.anio, b.mes, b.sede, coalesce(g.unidad_destino, b.unidad) unidad, b.linea, b.cuenta, b.fuente, b.monto
      from base b
      left join cuentas c on c.cuenta = b.cuenta
      left join mapa_excepciones x on x.cuenta = b.cuenta and x.unidad = b.unidad
      left join reglas_unidad g on g.activo and g.unidad_origen = b.unidad and g.rubro = coalesce(x.rubro, c.rubro)
  ),
  agrupado as (
    select escenario_id, anio, mes, sede, unidad, linea, cuenta, fuente, sum(monto) monto
      from movido group by 1, 2, 3, 4, 5, 6, 7, 8
  )
  select g.* from agrupado g
   where (select public.es_rol(array['admin', 'contabilidad'])) or public.puede_ver(g.sede, g.unidad, g.linea, g.cuenta)
$$;

grant execute on function public.resumen_montos_fuente(bigint[]) to authenticated;
