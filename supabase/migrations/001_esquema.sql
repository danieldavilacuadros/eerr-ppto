-- =============================================================================
-- Incamotors · EERR y Presupuesto
-- Esquema base + seguridad por roles (RLS)
-- Ejecutar en Supabase > SQL Editor (una sola vez), luego seed.sql
-- =============================================================================

-- ----------------------------------------------------------------- dimensiones
create table if not exists sedes (
  codigo text primary key,
  nombre text not null,
  orden  int  not null default 0
);

create table if not exists lineas_comerciales (
  codigo text primary key,
  nombre text not null,
  orden  int  not null default 0
);

create table if not exists unidades_negocio (
  codigo          text primary key,
  nombre          text not null,
  linea_comercial text not null references lineas_comerciales(codigo),
  orden           int  not null default 0
);

-- Linea / marca tal como viene en SAP (FOR, HPV, GEELY, CAS, MOB, ...)
create table if not exists lineas (
  codigo text primary key,
  nombre text not null
);

-- Centro de resultado = combinación valida sede + unidad de negocio + linea
create table if not exists centros (
  sede   text not null references sedes(codigo),
  unidad text not null references unidades_negocio(codigo),
  linea  text not null references lineas(codigo),
  activo boolean not null default true,
  primary key (sede, unidad, linea)
);

create table if not exists cuentas (
  cuenta         text primary key,           -- cuenta mayor SAP (7 dígitos)
  nombre         text not null,
  clase          text not null,              -- '6' gasto, '7' ingreso, 'E' estadística
  es_estadistica boolean not null default false,
  activa         boolean not null default true
);

-- Estructura de reportes: vista contable (ERI) y vista comercial (ER por línea)
create table if not exists rubros (
  vista   text not null check (vista in ('contable', 'comercial')),
  codigo  text not null,
  nombre  text not null,
  tipo    text not null check (tipo in ('seccion', 'detalle', 'total')),
  padre   text,                     -- detalle -> sección
  formula text[],                   -- total -> códigos de secciones/totales ('-X' resta)
  orden   int  not null,
  primary key (vista, codigo)
);

-- Cuenta -> rubro, por vista. unidad (opcional) permite excepciones por unidad de negocio.
create table if not exists mapeo_cuentas (
  id     bigint generated always as identity primary key,
  vista  text not null check (vista in ('contable', 'comercial')),
  cuenta text not null references cuentas(cuenta) on update cascade,
  unidad text references unidades_negocio(codigo),
  rubro  text not null,
  foreign key (vista, rubro) references rubros(vista, codigo) on update cascade
);
create unique index if not exists mapeo_cuentas_uq
  on mapeo_cuentas (vista, cuenta, coalesce(unidad, '*'));

create table if not exists tipo_cambio (
  anio int not null,
  mes  int not null check (mes between 1 and 12),
  tc   numeric(10, 4) not null,
  primary key (anio, mes)
);

create table if not exists escenarios (
  id     bigint generated always as identity primary key,
  codigo text unique not null,
  nombre text not null,
  anio   int  not null,
  tipo   text not null check (tipo in ('real', 'ppto')),
  estado text not null default 'abierto' check (estado in ('abierto', 'cerrado'))
);

-- ----------------------------------------------------------------- usuarios y roles
-- rol: admin        -> todo
--      contabilidad -> ve todo, carga real, ajustes/provisiones, mantiene mapeos
--      jefe         -> ve y edita presupuesto según sus accesos
--      lectura      -> solo ve según sus accesos
create table if not exists perfiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  nombre     text,
  cargo      text,
  rol        text not null default 'lectura'
             check (rol in ('admin', 'contabilidad', 'jefe', 'lectura')),
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Alcance de cada usuario. null = todos. Varias filas se suman (OR).
create table if not exists accesos (
  id             bigint generated always as identity primary key,
  perfil_id      uuid not null references perfiles(id) on delete cascade,
  sede           text references sedes(codigo),
  unidad         text references unidades_negocio(codigo),
  linea          text references lineas(codigo),
  cuenta_prefijo text,               -- ej. '7521' para ver sólo comisiones IF
  puede_editar   boolean not null default false
);
create index if not exists accesos_perfil_idx on accesos (perfil_id);

-- Crea el perfil al registrarse un usuario en Supabase Auth
create or replace function public.crear_perfil()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into perfiles (id, email, nombre)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.crear_perfil();

-- ----------------------------------------------------------------- hechos
-- Real (cargado desde SAP). Signo de presentación: ingresos +, gastos -.
create table if not exists real_montos (
  id          bigint generated always as identity primary key,
  escenario_id bigint not null references escenarios(id),
  anio        int  not null,
  mes         int  not null check (mes between 1 and 12),
  sede        text not null references sedes(codigo),
  unidad      text not null references unidades_negocio(codigo),
  linea       text not null references lineas(codigo),
  cuenta      text not null references cuentas(cuenta) on update cascade,
  monto       numeric(18, 2) not null default 0,
  lote        uuid,                       -- identificador de la carga
  created_at  timestamptz not null default now()
);
create index if not exists real_montos_idx on real_montos (escenario_id, anio, mes, sede, unidad, linea);

-- Presupuesto: una fila por escenario/mes/centro/cuenta. Signo de presentación.
create table if not exists ppto_montos (
  escenario_id bigint not null references escenarios(id),
  anio        int  not null,
  mes         int  not null check (mes between 1 and 12),
  sede        text not null references sedes(codigo),
  unidad      text not null references unidades_negocio(codigo),
  linea       text not null references lineas(codigo),
  cuenta      text not null references cuentas(cuenta) on update cascade,
  monto       numeric(18, 2) not null default 0,
  comentario  text,
  updated_by  uuid references perfiles(id) default auth.uid(),
  updated_at  timestamptz not null default now(),
  primary key (escenario_id, anio, mes, sede, unidad, linea, cuenta)
);

-- Historial de cambios del presupuesto (auditoría)
create table if not exists ppto_historial (
  id           bigint generated always as identity primary key,
  escenario_id bigint not null,
  anio int not null, mes int not null,
  sede text not null, unidad text not null, linea text not null, cuenta text not null,
  monto_anterior numeric(18, 2),
  monto_nuevo    numeric(18, 2),
  usuario    uuid default auth.uid(),
  fecha      timestamptz not null default now()
);

create or replace function public.ppto_sellar()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

-- AFTER: con upsert (insert ... on conflict update) sólo registra lo que realmente ocurrió
create or replace function public.ppto_auditar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    insert into ppto_historial (escenario_id, anio, mes, sede, unidad, linea, cuenta, monto_anterior, monto_nuevo)
    values (old.escenario_id, old.anio, old.mes, old.sede, old.unidad, old.linea, old.cuenta, old.monto, null);
  elsif tg_op = 'INSERT' or new.monto is distinct from old.monto then
    insert into ppto_historial (escenario_id, anio, mes, sede, unidad, linea, cuenta, monto_anterior, monto_nuevo)
    values (new.escenario_id, new.anio, new.mes, new.sede, new.unidad, new.linea, new.cuenta,
            case when tg_op = 'UPDATE' then old.monto end, new.monto);
  end if;
  return null;
end $$;

drop trigger if exists ppto_sellar_trg on ppto_montos;
create trigger ppto_sellar_trg before insert or update on ppto_montos
  for each row execute function public.ppto_sellar();
drop trigger if exists ppto_auditar_trg on ppto_montos;
create trigger ppto_auditar_trg after insert or update or delete on ppto_montos
  for each row execute function public.ppto_auditar();

-- Ajustes / provisiones / reclasificaciones de contabilidad (aplican sobre real o ppto)
create table if not exists ajustes (
  id           bigint generated always as identity primary key,
  escenario_id bigint not null references escenarios(id),
  anio         int not null,
  mes          int not null check (mes between 1 and 12),
  tipo         text not null check (tipo in ('provision', 'reclasificacion', 'asignacion')),
  descripcion  text not null,
  estado       text not null default 'aplicado' check (estado in ('borrador', 'aplicado', 'anulado')),
  created_by   uuid references perfiles(id) default auth.uid(),
  created_at   timestamptz not null default now()
);

create table if not exists ajuste_lineas (
  id        bigint generated always as identity primary key,
  ajuste_id bigint not null references ajustes(id) on delete cascade,
  sede      text not null references sedes(codigo),
  unidad    text not null references unidades_negocio(codigo),
  linea     text not null references lineas(codigo),
  cuenta    text not null references cuentas(cuenta) on update cascade,
  monto     numeric(18, 2) not null
);

-- ----------------------------------------------------------------- funciones de permisos
create or replace function public.mi_rol()
returns text language sql stable security definer set search_path = public as $$
  select rol from perfiles where id = auth.uid() and activo
$$;

create or replace function public.es_rol(roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.mi_rol() = any(roles), false)
$$;

create or replace function public.puede_ver(p_sede text, p_unidad text, p_linea text, p_cuenta text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.es_rol(array['admin', 'contabilidad'])
      or exists (
        select 1 from accesos a join perfiles p on p.id = a.perfil_id and p.activo
        where a.perfil_id = auth.uid()
          and (a.sede   is null or a.sede   = p_sede)
          and (a.unidad is null or a.unidad = p_unidad)
          and (a.linea  is null or a.linea  = p_linea)
          and (a.cuenta_prefijo is null or p_cuenta like a.cuenta_prefijo || '%'))
$$;

create or replace function public.puede_editar_ppto(p_escenario bigint, p_sede text, p_unidad text, p_linea text, p_cuenta text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from escenarios e where e.id = p_escenario and e.tipo = 'ppto' and e.estado = 'abierto')
     and (
       public.es_rol(array['admin'])
       or (public.es_rol(array['jefe', 'contabilidad']) and exists (
             select 1 from accesos a
             where a.perfil_id = auth.uid() and a.puede_editar
               and (a.sede   is null or a.sede   = p_sede)
               and (a.unidad is null or a.unidad = p_unidad)
               and (a.linea  is null or a.linea  = p_linea)
               and (a.cuenta_prefijo is null or p_cuenta like a.cuenta_prefijo || '%')))
     )
$$;

-- ----------------------------------------------------------------- RLS
alter table sedes              enable row level security;
alter table lineas_comerciales enable row level security;
alter table unidades_negocio   enable row level security;
alter table lineas             enable row level security;
alter table centros            enable row level security;
alter table cuentas            enable row level security;
alter table rubros             enable row level security;
alter table mapeo_cuentas      enable row level security;
alter table tipo_cambio        enable row level security;
alter table escenarios         enable row level security;
alter table perfiles           enable row level security;
alter table accesos            enable row level security;
alter table real_montos        enable row level security;
alter table ppto_montos        enable row level security;
alter table ppto_historial     enable row level security;
alter table ajustes            enable row level security;
alter table ajuste_lineas      enable row level security;

-- Catálogos: lectura para cualquier usuario autenticado; escritura admin/contabilidad
do $$
declare t text;
begin
  foreach t in array array['sedes','lineas_comerciales','unidades_negocio','lineas','centros',
                           'cuentas','rubros','mapeo_cuentas','tipo_cambio','escenarios'] loop
    execute format('drop policy if exists %1$s_sel on %1$s', t);
    execute format('create policy %1$s_sel on %1$s for select to authenticated using (true)', t);
    execute format('drop policy if exists %1$s_mod on %1$s', t);
    execute format($p$create policy %1$s_mod on %1$s for all to authenticated
                     using (public.es_rol(array['admin','contabilidad']))
                     with check (public.es_rol(array['admin','contabilidad']))$p$, t);
  end loop;
end $$;

-- Perfiles: cada uno ve el suyo; admin ve y edita todos
drop policy if exists perfiles_sel on perfiles;
create policy perfiles_sel on perfiles for select to authenticated
  using (id = auth.uid() or public.es_rol(array['admin', 'contabilidad']));
drop policy if exists perfiles_mod on perfiles;
create policy perfiles_mod on perfiles for update to authenticated
  using (public.es_rol(array['admin'])) with check (public.es_rol(array['admin']));

drop policy if exists accesos_sel on accesos;
create policy accesos_sel on accesos for select to authenticated
  using (perfil_id = auth.uid() or public.es_rol(array['admin', 'contabilidad']));
drop policy if exists accesos_mod on accesos;
create policy accesos_mod on accesos for all to authenticated
  using (public.es_rol(array['admin'])) with check (public.es_rol(array['admin']));

-- Real
drop policy if exists real_sel on real_montos;
create policy real_sel on real_montos for select to authenticated
  using (public.puede_ver(sede, unidad, linea, cuenta));
drop policy if exists real_mod on real_montos;
create policy real_mod on real_montos for all to authenticated
  using (public.es_rol(array['admin', 'contabilidad']))
  with check (public.es_rol(array['admin', 'contabilidad']));

-- Presupuesto
drop policy if exists ppto_sel on ppto_montos;
create policy ppto_sel on ppto_montos for select to authenticated
  using (public.puede_ver(sede, unidad, linea, cuenta));
drop policy if exists ppto_ins on ppto_montos;
create policy ppto_ins on ppto_montos for insert to authenticated
  with check (public.puede_editar_ppto(escenario_id, sede, unidad, linea, cuenta));
drop policy if exists ppto_upd on ppto_montos;
create policy ppto_upd on ppto_montos for update to authenticated
  using (public.puede_editar_ppto(escenario_id, sede, unidad, linea, cuenta))
  with check (public.puede_editar_ppto(escenario_id, sede, unidad, linea, cuenta));
drop policy if exists ppto_del on ppto_montos;
create policy ppto_del on ppto_montos for delete to authenticated
  using (public.puede_editar_ppto(escenario_id, sede, unidad, linea, cuenta));

drop policy if exists ppto_hist_sel on ppto_historial;
create policy ppto_hist_sel on ppto_historial for select to authenticated
  using (public.puede_ver(sede, unidad, linea, cuenta));

-- Ajustes de contabilidad
drop policy if exists ajustes_sel on ajustes;
create policy ajustes_sel on ajustes for select to authenticated using (true);
drop policy if exists ajustes_mod on ajustes;
create policy ajustes_mod on ajustes for all to authenticated
  using (public.es_rol(array['admin', 'contabilidad']))
  with check (public.es_rol(array['admin', 'contabilidad']));

drop policy if exists ajuste_lineas_sel on ajuste_lineas;
create policy ajuste_lineas_sel on ajuste_lineas for select to authenticated
  using (public.puede_ver(sede, unidad, linea, cuenta));
drop policy if exists ajuste_lineas_mod on ajuste_lineas;
create policy ajuste_lineas_mod on ajuste_lineas for all to authenticated
  using (public.es_rol(array['admin', 'contabilidad']))
  with check (public.es_rol(array['admin', 'contabilidad']));

-- ----------------------------------------------------------------- consulta para reportes
-- Devuelve montos agregados por mes/centro/cuenta para los escenarios pedidos.
-- Corre con los permisos del usuario (RLS aplica): cada quien ve sólo su alcance.
create or replace function public.resumen_montos(p_escenarios bigint[], p_incluir_ajustes boolean default true)
returns table (escenario_id bigint, anio int, mes int, sede text, unidad text, linea text, cuenta text, monto numeric)
language sql stable security invoker set search_path = public as $$
  select x.escenario_id, x.anio, x.mes, x.sede, x.unidad, x.linea, x.cuenta, sum(x.monto)
  from (
    select r.escenario_id, r.anio, r.mes, r.sede, r.unidad, r.linea, r.cuenta, r.monto
      from real_montos r where r.escenario_id = any(p_escenarios)
    union all
    select p.escenario_id, p.anio, p.mes, p.sede, p.unidad, p.linea, p.cuenta, p.monto
      from ppto_montos p where p.escenario_id = any(p_escenarios)
    union all
    select a.escenario_id, a.anio, a.mes, l.sede, l.unidad, l.linea, l.cuenta, l.monto
      from ajustes a join ajuste_lineas l on l.ajuste_id = a.id
     where p_incluir_ajustes and a.estado = 'aplicado' and a.escenario_id = any(p_escenarios)
  ) x
  group by 1, 2, 3, 4, 5, 6, 7
$$;

grant execute on function public.resumen_montos(bigint[], boolean) to authenticated;
grant execute on function public.mi_rol() to authenticated;
