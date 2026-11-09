-- 005 · Nuevo modelo: un solo mapa cuenta → rubro y los reportes "Esquema 1" y "Esquema 2"
-- Ejecutar una sola vez en Supabase › SQL Editor (después de 004). Luego ejecutar supabase/datos_005_modelo.sql.
-- Reemplaza a las vistas contable/comercial (tablas rubros, mapeo_cuentas, consolidado_secciones), que se
-- conservan sin uso.

-- ------------------------------------------------------------------ rubros y mapa de cuentas
-- Rubro = agrupación del reporte ("UNIDADES +", "SUELDOS", …). Cada cuenta mayor va a un solo rubro, igual
-- para todas las sedes, unidades, líneas y marcas.
create table if not exists rubros_eerr (
  codigo text primary key,
  orden  int not null default 0
);

alter table cuentas add column if not exists rubro text references rubros_eerr(codigo) on update cascade;

-- Excepción: una cuenta que en cierta unidad de negocio va a otro rubro (ej. 7599100 en UNI = incentivo fuerza de ventas)
create table if not exists mapa_excepciones (
  cuenta text not null references cuentas(cuenta) on update cascade,
  unidad text not null references unidades_negocio(codigo),
  rubro  text not null references rubros_eerr(codigo) on update cascade,
  primary key (cuenta, unidad)
);

-- ------------------------------------------------------------------ filas de los esquemas
-- tipo: grupo   = suma de sus filas hijas (padre = esta fila)
--       rubro   = suma de las cuentas del rubro
--       formula = suma de las filas de formula ('-F27' resta)
--       pct     = formula[1] / formula[2] (fila de %)
--       manual  = monto de la empresa (participaciones, impuesto a la renta); sólo en el total de la empresa
-- base: fila sobre la que se calcula el % de la columna "%".
create table if not exists esquema_filas (
  esquema  text not null check (esquema in ('E1', 'E2')),
  codigo   text not null,
  orden    int  not null,
  etiqueta text,
  nivel    int  not null default 0,
  tipo     text not null check (tipo in ('grupo', 'rubro', 'formula', 'pct', 'manual')),
  padre    text,
  rubro    text references rubros_eerr(codigo) on update cascade,
  formula  text[],
  base     text,
  concepto text,
  negrita  boolean not null default false,
  primary key (esquema, codigo)
);

-- ------------------------------------------------------------------ montos de la empresa
-- Participaciones de empleados e impuesto a la renta: no salen de cuentas; se calculan sólo para el
-- total de la empresa y los ingresa contabilidad por mes.
create table if not exists montos_empresa (
  escenario_id bigint not null references escenarios(id),
  anio     int  not null,
  mes      int  not null check (mes between 1 and 12),
  concepto text not null check (concepto in ('PARTICIPACIONES', 'IR_DIFERIDO', 'IR_CORRIENTE')),
  monto    numeric(18, 2) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (escenario_id, anio, mes, concepto)
);

-- ------------------------------------------------------------------ empresa de cada marca
-- Nova Autos: Chevrolet e Isuzu; Incamotors: el resto.
alter table lineas add column if not exists empresa text not null default 'INCAMOTORS'
  check (empresa in ('INCAMOTORS', 'NOVA_AUTOS'));

-- ------------------------------------------------------------------ seguridad
alter table rubros_eerr    enable row level security;
alter table mapa_excepciones enable row level security;
alter table esquema_filas  enable row level security;
alter table montos_empresa enable row level security;

drop policy if exists rubros_eerr_sel on rubros_eerr;
create policy rubros_eerr_sel on rubros_eerr for select to authenticated using (true);
drop policy if exists rubros_eerr_mod on rubros_eerr;
create policy rubros_eerr_mod on rubros_eerr for all to authenticated
  using (public.es_rol(array['admin', 'contabilidad']))
  with check (public.es_rol(array['admin', 'contabilidad']));

drop policy if exists mapa_excepciones_sel on mapa_excepciones;
create policy mapa_excepciones_sel on mapa_excepciones for select to authenticated using (true);
drop policy if exists mapa_excepciones_mod on mapa_excepciones;
create policy mapa_excepciones_mod on mapa_excepciones for all to authenticated
  using (public.es_rol(array['admin', 'contabilidad']))
  with check (public.es_rol(array['admin', 'contabilidad']));

drop policy if exists esquema_filas_sel on esquema_filas;
create policy esquema_filas_sel on esquema_filas for select to authenticated using (true);
drop policy if exists esquema_filas_mod on esquema_filas;
create policy esquema_filas_mod on esquema_filas for all to authenticated
  using (public.es_rol(array['admin', 'contabilidad']))
  with check (public.es_rol(array['admin', 'contabilidad']));

-- montos de toda la empresa: sólo admin y contabilidad
drop policy if exists montos_empresa_sel on montos_empresa;
create policy montos_empresa_sel on montos_empresa for select to authenticated
  using (public.es_rol(array['admin', 'contabilidad']));
drop policy if exists montos_empresa_mod on montos_empresa;
create policy montos_empresa_mod on montos_empresa for all to authenticated
  using (public.es_rol(array['admin', 'contabilidad']))
  with check (public.es_rol(array['admin', 'contabilidad']));
