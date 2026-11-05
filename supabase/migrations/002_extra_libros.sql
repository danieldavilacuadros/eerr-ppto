-- 002 · Registro extra libros
-- Montos que contabilidad agrega al real fuera de SAP (bono retail, planilla/cierres sin centro,
-- reclasificaciones manuales, etc.), con la misma forma del "Modelo Registro Extra Libros":
-- una fila por sede · unidad · línea · cuenta y un importe por mes.
-- Signo de presentación, igual que real_montos: ingresos (+), costos y gastos (−).
-- Ejecutar una sola vez en Supabase › SQL Editor (después de 001_esquema.sql).

create table if not exists extra_libros (
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

-- Historial de cambios (auditoría): quién cambió qué y cuándo
create table if not exists extra_libros_historial (
  id           bigint generated always as identity primary key,
  escenario_id bigint not null,
  anio int not null, mes int not null,
  sede text not null, unidad text not null, linea text not null, cuenta text not null,
  monto_anterior numeric(18, 2),
  monto_nuevo    numeric(18, 2),
  usuario    uuid default auth.uid(),
  fecha      timestamptz not null default now()
);

create or replace function public.extra_libros_auditar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    insert into extra_libros_historial (escenario_id, anio, mes, sede, unidad, linea, cuenta, monto_anterior, monto_nuevo)
    values (old.escenario_id, old.anio, old.mes, old.sede, old.unidad, old.linea, old.cuenta, old.monto, null);
  elsif tg_op = 'INSERT' or new.monto is distinct from old.monto then
    insert into extra_libros_historial (escenario_id, anio, mes, sede, unidad, linea, cuenta, monto_anterior, monto_nuevo)
    values (new.escenario_id, new.anio, new.mes, new.sede, new.unidad, new.linea, new.cuenta,
            case when tg_op = 'UPDATE' then old.monto end, new.monto);
  end if;
  return null;
end $$;

-- reutiliza el sellado de fecha/usuario del presupuesto
drop trigger if exists extra_libros_sellar_trg on extra_libros;
create trigger extra_libros_sellar_trg before insert or update on extra_libros
  for each row execute function public.ppto_sellar();
drop trigger if exists extra_libros_auditar_trg on extra_libros;
create trigger extra_libros_auditar_trg after insert or update or delete on extra_libros
  for each row execute function public.extra_libros_auditar();

-- Seguridad: todos ven según su alcance; sólo admin y contabilidad registran
alter table extra_libros           enable row level security;
alter table extra_libros_historial enable row level security;

drop policy if exists extra_libros_sel on extra_libros;
create policy extra_libros_sel on extra_libros for select to authenticated
  using (public.puede_ver(sede, unidad, linea, cuenta));
drop policy if exists extra_libros_mod on extra_libros;
create policy extra_libros_mod on extra_libros for all to authenticated
  using (public.es_rol(array['admin', 'contabilidad']))
  with check (public.es_rol(array['admin', 'contabilidad']));

drop policy if exists extra_libros_hist_sel on extra_libros_historial;
create policy extra_libros_hist_sel on extra_libros_historial for select to authenticated
  using (public.es_rol(array['admin', 'contabilidad']));

-- Reportes: el real = SAP + extra libros (los extra libros siempre forman parte del real;
-- p_incluir_ajustes sigue controlando sólo los ajustes/provisiones)
create or replace function public.resumen_montos(p_escenarios bigint[], p_incluir_ajustes boolean default true)
returns table (escenario_id bigint, anio int, mes int, sede text, unidad text, linea text, cuenta text, monto numeric)
language sql stable security invoker set search_path = public as $$
  select x.escenario_id, x.anio, x.mes, x.sede, x.unidad, x.linea, x.cuenta, sum(x.monto)
  from (
    select r.escenario_id, r.anio, r.mes, r.sede, r.unidad, r.linea, r.cuenta, r.monto
      from real_montos r where r.escenario_id = any(p_escenarios)
    union all
    select e.escenario_id, e.anio, e.mes, e.sede, e.unidad, e.linea, e.cuenta, e.monto
      from extra_libros e where e.escenario_id = any(p_escenarios)
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
