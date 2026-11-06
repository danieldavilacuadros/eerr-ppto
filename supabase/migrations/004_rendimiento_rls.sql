-- 004 · Rendimiento de la seguridad (RLS) con volumen real
-- Con el real 2026 cargado (~26 mil filas) la consulta de reportes excedía el tiempo límite: la política evaluaba
-- puede_ver() fila por fila, incluso para admin y contabilidad. Ahora el rol se evalúa UNA vez por consulta
-- ((select ...) = initplan, recomendación de Supabase) y puede_ver() sólo se usa para jefes y lectura.
-- Ejecutar una sola vez en Supabase › SQL Editor (después de 003).

drop policy if exists real_sel on real_montos;
create policy real_sel on real_montos for select to authenticated
  using ((select public.es_rol(array['admin', 'contabilidad'])) or public.puede_ver(sede, unidad, linea, cuenta));

drop policy if exists extra_libros_sel on extra_libros;
create policy extra_libros_sel on extra_libros for select to authenticated
  using ((select public.es_rol(array['admin', 'contabilidad'])) or public.puede_ver(sede, unidad, linea, cuenta));

drop policy if exists ppto_sel on ppto_montos;
create policy ppto_sel on ppto_montos for select to authenticated
  using ((select public.es_rol(array['admin', 'contabilidad'])) or public.puede_ver(sede, unidad, linea, cuenta));

drop policy if exists ajuste_lineas_sel on ajuste_lineas;
create policy ajuste_lineas_sel on ajuste_lineas for select to authenticated
  using ((select public.es_rol(array['admin', 'contabilidad'])) or public.puede_ver(sede, unidad, linea, cuenta));

-- índices para el filtro por escenario de la función de reportes
create index if not exists extra_libros_esc_idx on extra_libros (escenario_id, anio, mes);
create index if not exists ppto_montos_esc_idx on ppto_montos (escenario_id, anio, mes);
analyze real_montos;
analyze extra_libros;
