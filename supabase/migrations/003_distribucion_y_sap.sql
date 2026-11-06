-- 003 · Factores de distribución de gastos generales y pedidos de actualización desde SAP
-- Ejecutar una sola vez en Supabase › SQL Editor (después de 002_extra_libros.sql).

-- ------------------------------------------------------------------ factores de distribución
-- En la vista general (todas las líneas juntas) los gastos generales (unidad GEN) y la exposición al
-- tipo de cambio se reparten a cada línea: monto = factor × ingresos de la línea (ventas netas + otros
-- ingresos) del mes. El factor sale del ER por líneas de contabilidad (reparto ÷ ingresos), por eso
-- reproduce sus cifras; para meses sin factor se usa el último disponible (aproximado).
-- Alcance del factor: sede (null = todas) · unidad · línea (null = todas las líneas de esa unidad).
-- Para unidad 'UNI' el factor se aplica a UNI y ACC de esa línea (así arma contabilidad sus hojas).
create table if not exists factores_distribucion (
  id        bigint generated always as identity primary key,
  anio      int  not null,
  mes       int  not null check (mes between 1 and 12),
  concepto  text not null check (concepto in ('GG', 'TC')),
  sede      text references sedes(codigo),
  unidad    text not null references unidades_negocio(codigo),
  linea     text references lineas(codigo),
  factor    numeric(20, 12) not null,
  hoja_er   text,
  updated_at timestamptz not null default now()
);
create unique index if not exists factores_distribucion_uq
  on factores_distribucion (anio, mes, concepto, coalesce(sede, ''), unidad, coalesce(linea, ''));

alter table factores_distribucion enable row level security;
drop policy if exists factores_sel on factores_distribucion;
create policy factores_sel on factores_distribucion for select to authenticated using (true);
drop policy if exists factores_mod on factores_distribucion;
create policy factores_mod on factores_distribucion for all to authenticated
  using (public.es_rol(array['admin', 'contabilidad']))
  with check (public.es_rol(array['admin', 'contabilidad']));

-- ------------------------------------------------------------------ agrupación de la vista consolidada
-- Mantenimiento (contabilidad/admin): a qué concepto consolidado va cada sección de la vista comercial.
-- Conceptos: INGRESOS, COSTOS, GASTOS (→ margen de contribución), GASTOS_INDIRECTOS, OTROS (→ resultado operativo),
-- PROVISIONES (→ resultado operativo neto) y NO_INCLUIR. Las cuentas nuevas se asignan a un rubro en Mapeo de cuentas.
create table if not exists consolidado_secciones (
  seccion   text primary key,
  concepto  text not null check (concepto in ('INGRESOS', 'COSTOS', 'GASTOS', 'GASTOS_INDIRECTOS', 'OTROS', 'PROVISIONES', 'NO_INCLUIR')),
  updated_at timestamptz not null default now()
);
insert into consolidado_secciones (seccion, concepto) values
  ('M_VENTAS', 'INGRESOS'), ('M_OTROS', 'INGRESOS'), ('M_COSTO', 'COSTOS'),
  ('M_FLETES', 'GASTOS'), ('M_GDF', 'GASTOS'), ('M_GDV', 'GASTOS'),
  ('M_GI', 'GASTOS_INDIRECTOS'), ('M_OIG', 'OTROS'), ('M_GG', 'PROVISIONES')
on conflict (seccion) do nothing;

alter table consolidado_secciones enable row level security;
drop policy if exists consolidado_sel on consolidado_secciones;
create policy consolidado_sel on consolidado_secciones for select to authenticated using (true);
drop policy if exists consolidado_mod on consolidado_secciones;
create policy consolidado_mod on consolidado_secciones for all to authenticated
  using (public.es_rol(array['admin', 'contabilidad']))
  with check (public.es_rol(array['admin', 'contabilidad']));

-- ------------------------------------------------------------------ pedidos de actualización desde SAP
-- El botón "Actualizar último mes desde SAP" deja un pedido; el script de la PC con acceso a SAP
-- (scripts/sap_sincronizar_real.ps1) lo atiende: lee SAP (sólo lectura) y reemplaza el real de ese mes.
create table if not exists sap_pedidos (
  id          bigint generated always as identity primary key,
  anio        int  not null,
  mes         int  not null check (mes between 1 and 12),
  estado      text not null default 'pendiente' check (estado in ('pendiente', 'procesando', 'ok', 'error')),
  mensaje     text,
  pedido_por  uuid references perfiles(id) default auth.uid(),
  pedido_en   timestamptz not null default now(),
  atendido_en timestamptz,
  atendido_por text
);

alter table sap_pedidos enable row level security;
drop policy if exists sap_pedidos_sel on sap_pedidos;
create policy sap_pedidos_sel on sap_pedidos for select to authenticated
  using (public.es_rol(array['admin', 'contabilidad']));
drop policy if exists sap_pedidos_mod on sap_pedidos;
create policy sap_pedidos_mod on sap_pedidos for all to authenticated
  using (public.es_rol(array['admin', 'contabilidad']))
  with check (public.es_rol(array['admin', 'contabilidad']));
