-- 006 · Real 2026 por fuente: SAP (real_montos) separado de los extra libros y ajustes de contabilidad.
-- Ejecutar una sola vez en Supabase › SQL Editor (después de 005).
-- Igual que resumen_montos, pero con la columna fuente:
--   'SAP'   = real_montos (lo que trae SAP, sin cambios)
--   'EXTRA' = extra_libros + ajustes aplicados (contabilidad)
--   'PPTO'  = ppto_montos
create or replace function public.resumen_montos_fuente(p_escenarios bigint[])
returns table (escenario_id bigint, anio int, mes int, sede text, unidad text, linea text, cuenta text, fuente text, monto numeric)
language sql stable security invoker set search_path = public as $$
  select x.escenario_id, x.anio, x.mes, x.sede, x.unidad, x.linea, x.cuenta, x.fuente, sum(x.monto)
  from (
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
  ) x
  group by 1, 2, 3, 4, 5, 6, 7, 8
$$;

grant execute on function public.resumen_montos_fuente(bigint[]) to authenticated;

comment on table montos_empresa is
  'Participaciones e impuesto a la renta por mes (ajuste de contabilidad, nivel empresa). En los reportes del real se tratan como extra libros.';
