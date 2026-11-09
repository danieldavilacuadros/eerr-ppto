"""
Genera supabase/datos_006_ajustes_mapa.sql: reemplaza los extra libros del Real 2026 (enero–setiembre) por la
diferencia entre el "MAPA DE CUENTAS" del Excel del modelo y lo que trae SAP (real_montos), cuenta por cuenta y mes
por mes. Así el Esquema 1 y 2 de la plataforma cuadran con el Excel.

Cada ajuste va al centro (sede · unidad · línea) donde SAP tiene el mayor monto de esa cuenta ese mes; si SAP no la
tiene ese mes, al de mayor monto en el año; si nunca la tuvo, a Arequipa · Gastos generales · General.
La cuenta 7599100 está partida en el Excel: la fila "INCENTIVO FUERZA DE VENTAS" se compara con SAP en la unidad UNI
y la de "OTROS INGRESOS" con SAP en las demás unidades (igual que la excepción del mapa).

Uso:
  python scripts/generar_ajustes_mapa.py "Modelo EERR1 incamotors noviembre.xlsx" [salida.sql]
"""
import re
import sys

import openpyxl

MAPA_COL = [6, 8, 10, 12, 14, 16, 18, 20, 22]  # ene..set soles
PARTIDAS = {('7599100', 'INCENTIVO FUERZA DE VENTAS'): 'UNI', ('7599100', 'OTROS INGRESOS'): 'NO_UNI'}
COMENTARIO = 'Ajuste mapa Excel (Modelo EERR1 noviembre)'


def limpiar(s):
    return re.sub(r'\s+', ' ', str(s)).strip() if s is not None else None


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    salida = sys.argv[2] if len(sys.argv) > 2 else 'supabase/datos_006_ajustes_mapa.sql'
    ws = openpyxl.load_workbook(sys.argv[1], data_only=True)['MAPA DE CUENTAS']
    valores = []
    for r in range(2, ws.max_row + 1):
        c = ws.cell(r, 1).value
        if c is None:
            continue
        c, rubro = str(c).strip(), limpiar(ws.cell(r, 3).value)
        grupo = PARTIDAS.get((c, rubro), '')
        for mes, col in enumerate(MAPA_COL, start=1):
            v = round(float(ws.cell(r, col).value or 0), 2)
            if v:
                valores.append(f"('{c}', '{grupo}', {mes}, {v})")

    sql = f"""-- Generado por scripts/generar_ajustes_mapa.py desde "Modelo EERR1 incamotors noviembre.xlsx". No editar a mano.
-- Reemplaza los extra libros del Real 2026 ene–set por: mapa del Excel − SAP, por cuenta y mes.
-- Respaldo de los extra libros anteriores en extra_libros_respaldo_20261109 (y en extra_libros_historial).
begin;

create table if not exists extra_libros_respaldo_20261109 as select * from extra_libros;
alter table extra_libros_respaldo_20261109 enable row level security;

delete from extra_libros
 where escenario_id = (select id from escenarios where codigo = 'REAL_2026') and anio = 2026 and mes between 1 and 9;

insert into extra_libros (escenario_id, anio, mes, sede, unidad, linea, cuenta, monto, comentario)
with mapa_obj (cuenta, grupo, mes, monto) as (values
  {(','+chr(10)+'  ').join(valores)}),
esc as (select id from escenarios where codigo = 'REAL_2026'),
sap as (
  select r.cuenta, r.mes, r.sede, r.unidad, r.linea, sum(r.monto) m,
         case when r.cuenta = '7599100' then case when r.unidad = 'UNI' then 'UNI' else 'NO_UNI' end else '' end grupo
    from real_montos r, esc
   where r.escenario_id = esc.id and r.anio = 2026 and r.mes between 1 and 9
     and r.cuenta not in (select cuenta from cuentas where es_estadistica)
   group by r.cuenta, r.mes, r.sede, r.unidad, r.linea),
tot as (select cuenta, grupo, mes, sum(m) m from sap group by 1, 2, 3),
obj as (select cuenta, grupo, mes, sum(monto) monto from mapa_obj group by 1, 2, 3),
claves as (select cuenta, grupo, mes from obj union select cuenta, grupo, mes from tot),
dif as (
  select k.cuenta, k.grupo, k.mes, round(coalesce(o.monto, 0) - coalesce(t.m, 0), 2) d
    from claves k
    left join obj o on o.cuenta = k.cuenta and o.grupo = k.grupo and o.mes = k.mes
    left join tot t on t.cuenta = k.cuenta and t.grupo = k.grupo and t.mes = k.mes),
centro_mes as (
  select distinct on (cuenta, grupo, mes) cuenta, grupo, mes, sede, unidad, linea
    from sap order by cuenta, grupo, mes, abs(m) desc),
centro_anio as (
  select distinct on (cuenta, grupo) cuenta, grupo, sede, unidad, linea
    from (select cuenta, grupo, sede, unidad, linea, sum(m) m from sap group by 1, 2, 3, 4, 5) x
   order by cuenta, grupo, abs(m) desc)
select (select id from esc), 2026, d.mes,
       coalesce(cm.sede, ca.sede, 'AQP') sede,
       coalesce(cm.unidad, ca.unidad, case when d.grupo = 'UNI' then 'UNI' else 'GEN' end) unidad,
       coalesce(cm.linea, ca.linea, 'GENERAL') linea,
       d.cuenta, sum(d.d), '{COMENTARIO}'
  from dif d
  left join centro_mes cm on cm.cuenta = d.cuenta and cm.grupo = d.grupo and cm.mes = d.mes
  left join centro_anio ca on ca.cuenta = d.cuenta and ca.grupo = d.grupo
 where abs(d.d) >= 0.005
 group by 1, 2, 3, 4, 5, 6, 7
having abs(sum(d.d)) >= 0.005;

commit;
"""
    open(salida, 'w', encoding='utf-8', newline='\n').write(sql)
    print(f'{salida}: {len(valores)} montos del mapa')


if __name__ == '__main__':
    main()
