-- Datos 008 · Excepciones iniciales por vista (09/11/2026, pedido de Daniel)
-- En cada vista con movimiento SAP en el Real 2026 se QUITAN las cuentas de la lista de su unidad que esa vista no usó
-- en 2026 (ej. la vista Arequipa · Venta de unidades · BAIC deja de mostrar "UNIDADES FORD").
-- Las vistas sin movimiento 2026 conservan la lista completa de su unidad. No toca excepciones ya existentes.
-- Se puede volver a ejecutar: sólo agrega las que falten. Ejecutar en Supabase › SQL Editor (después de 008).

with usadas as (
  select distinct r.sede, r.unidad, r.linea, r.cuenta
    from real_montos r
    join escenarios e on e.id = r.escenario_id and e.tipo = 'real' and e.anio = 2026
),
vistas_con_real as (select distinct sede, unidad, linea from usadas)
insert into vista_cuentas (sede, unidad, linea, cuenta, incluir)
select c.sede, c.unidad, c.linea, l.cuenta, false
  from centros c
  join vistas_con_real v on v.sede = c.sede and v.unidad = c.unidad and v.linea = c.linea
  join unidad_cuentas l on l.unidad = c.unidad
  left join usadas u on u.sede = c.sede and u.unidad = c.unidad and u.linea = c.linea and u.cuenta = l.cuenta
 where u.cuenta is null
on conflict (sede, unidad, linea, cuenta) do nothing;

-- control: excepciones por unidad
select unidad, count(*) filter (where not incluir) quitadas, count(*) filter (where incluir) agregadas
  from vista_cuentas group by unidad order by unidad;
