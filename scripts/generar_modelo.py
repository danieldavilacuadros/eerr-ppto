"""
Genera supabase/datos_005_modelo.sql desde el Excel "Modelo EERR1 incamotors noviembre.xlsx":

  - Hoja "MAPA DE CUENTAS - ok": cuenta mayor -> nombre a mostrar -> rubro (un solo mapa para toda la empresa).
  - Hojas "ESQUEMA 1" y "ESQUEMA 2": filas de cada reporte con sus agrupaciones (niveles 0/1/2 del Excel),
    subtotales (SUM de un rango), totales (sumas/restas de otras filas) y filas de % (fila / ventas netas).
  - Participaciones de empleados e impuesto a la renta: van escritos a mano en los esquemas (no salen de
    cuentas); se cargan como montos de la empresa para el Real 2026.

Uso:
  python scripts/generar_modelo.py "Modelo EERR1 incamotors noviembre.xlsx" [salida.sql] [--json pruebas.json]
"""
import json
import re
import sys

import openpyxl

MESES_COL = ['C', 'E', 'G', 'I', 'K', 'M', 'O', 'Q', 'S']  # ene..set en los esquemas
MAPA_COL = [6, 8, 10, 12, 14, 16, 18, 20, 22]               # ene..set soles en "MAPA DE CUENTAS"

# Cuentas que SAP trajo después del Excel: toman el rubro de una cuenta hermana del mapa
HERMANAS = {
    '6551510': '6551410', '6861900': '6593100', '7041084': '7041089', '7411186': '7411118',
    '6551100': '6551300', '6911124': '6911107', '6941095': '6941094', '7011124': '7011107', '7411107': '7411118',
}

# Filas escritas a mano en el Excel (no salen de cuentas): concepto de empresa
MANUALES = {
    'PARTICIPACIONES DE EMPLEADOS': 'PARTICIPACIONES',
    'IMPUESTO A LA RENTA DIFERIDO': 'IR_DIFERIDO',
    'IMPUESTO A LA RENTA CORRIENTE': 'IR_CORRIENTE',
}

# Correcciones de etiquetas del Excel (errores de copia)
ETIQUETAS = {
    ('E2', 12): 'UNIDADES -',
    ('E2', 58): 'POST VENTA - UTILIDAD BRUTA DE OPERACIÓN',
}

# Cuenta repetida en el mapa con otro rubro: en el Excel se parte a mano; en la plataforma, por unidad de negocio
EXCEPCIONES = {('7599100', 'INCENTIVO FUERZA DE VENTAS'): ['UNI']}

# Rubro del mapa que no figura en los esquemas: se agrega dentro de "OTROS INGRESOS Y GASTOS"
RUBROS_FALTANTES = ['OTROS INGRESOS Y GASTOS']


def q(s):
    return "null" if s is None else "'" + str(s).replace("'", "''") + "'"


def arr(xs):
    return "null" if not xs else "array[" + ", ".join(q(x) for x in xs) + "]"


def limpiar(s):
    return re.sub(r'\s+', ' ', str(s)).strip() if s is not None else None


def leer_mapa(wb):
    """Devuelve el mapa (primera aparición de cada cuenta) y las excepciones por unidad (repetidas)."""
    ws = wb['MAPA DE CUENTAS - ok']
    mapa, vistas, excepciones = [], set(), []
    for r in ws.iter_rows(min_row=2, values_only=True):
        if r[0] is None:
            continue
        c, n, ru = str(r[0]).strip(), limpiar(r[1]), limpiar(r[2])
        if c in vistas:
            unidades = EXCEPCIONES.get((c, ru))
            if not unidades:
                raise SystemExit(f'Cuenta {c} repetida en el mapa con rubro {ru}: definir sus unidades en EXCEPCIONES')
            excepciones += [(c, u, ru) for u in unidades]
            continue
        vistas.add(c)
        mapa.append((c, n, ru))
    return mapa, excepciones


def filas_ref(formula):
    """Devuelve [(signo, fila)] de una fórmula tipo '=+C120-C113-C117' o '=C8+C19'."""
    return [(s or '+', int(n)) for s, n in re.findall(r'([+-]?)\$?C\$?(\d+)', formula)]


def leer_esquema(wbf, wbv, hoja, clave):
    ws, wv = wbf[hoja], wbv[hoja]
    filas = {}
    for r in range(7, ws.max_row + 1):
        etiqueta = limpiar(ws.cell(r, 2).value)
        f = ws.cell(r, 3).value
        if etiqueta is None and f is None:
            continue
        etiqueta = ETIQUETAS.get((clave, r), etiqueta)
        rd = ws.row_dimensions[r]
        fila = {
            'fila': r, 'etiqueta': etiqueta, 'nivel': rd.outline_level or 0,
            'negrita': bool(ws.cell(r, 2).font and ws.cell(r, 2).font.b),
            'tipo': None, 'rubro': None, 'formula': None, 'hijos': [], 'base': None, 'concepto': None,
            'esperado': wv.cell(r, 22).value,  # total ene–set del Excel (columna V)
        }
        fs = str(f) if f is not None else ''
        if 'SUMIFS' in fs:
            fila['tipo'], fila['rubro'] = 'rubro', etiqueta
        elif re.fullmatch(r'=SUM\(C(\d+):C(\d+)\)', fs):
            a, b = map(int, re.fullmatch(r'=SUM\(C(\d+):C(\d+)\)', fs).groups())
            fila['tipo'], fila['hijos'] = 'grupo', list(range(a, b + 1))
        elif re.fullmatch(r'=\+?C(\d+)/C(\d+)', fs):
            a, b = map(int, re.fullmatch(r'=\+?C(\d+)/C(\d+)', fs).groups())
            fila['tipo'], fila['formula'] = 'pct', [f'F{a}', f'F{b}']
        elif fs.startswith('='):
            refs = filas_ref(fs)
            if len(refs) == 1 and refs[0][1] == r + 1:
                fila['tipo'], fila['hijos'] = 'grupo', [r + 1]
            else:
                fila['tipo'], fila['formula'] = 'formula', [('-' if s == '-' else '') + f'F{n}' for s, n in refs]
        elif isinstance(f, (int, float)):
            fila['tipo'], fila['concepto'] = 'manual', MANUALES.get(etiqueta)
            if not fila['concepto']:
                raise SystemExit(f'{hoja} fila {r}: valor fijo sin concepto conocido ({etiqueta})')
            fila['manual'] = [float(ws.cell(r, ord(c) - 64).value or 0) for c in MESES_COL]
        else:
            raise SystemExit(f'{hoja} fila {r}: fórmula no reconocida {fs!r}')
        # base del %: denominador de la columna D (fila / ventas o / ingreso de la línea)
        d = str(ws.cell(r, 4).value or '')
        m = re.search(r'C\$?(\d+)\s*[,)]', d)
        fila['base'] = int(m.group(1)) if m else None
        filas[r] = fila
    # padres: hijos de cada grupo
    for p in filas.values():
        for h in p['hijos']:
            if h in filas:
                filas[h]['padre'] = p['fila']
    # el % se calcula sobre ventas netas, salvo las utilidades brutas por línea del Esquema 2 (sobre el ingreso
    # de su línea); en el Esquema 1 hay filas con denominador mal copiado, se fuerzan a ventas netas
    ventas = next(f['fila'] for f in filas.values() if f['etiqueta'] and f['etiqueta'].startswith('VENTAS NETAS'))
    for f in filas.values():
        if f['tipo'] == 'pct':
            f['base'] = int(f['formula'][1][1:])
        elif clave == 'E1' or f['base'] not in filas or filas[f['base']]['tipo'] in (None, 'pct'):
            f['base'] = ventas
    return filas


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    xls = sys.argv[1]
    salida = sys.argv[2] if len(sys.argv) > 2 and not sys.argv[2].startswith('--') else 'supabase/datos_005_modelo.sql'
    pruebas = sys.argv[sys.argv.index('--json') + 1] if '--json' in sys.argv else None

    wbf = openpyxl.load_workbook(xls)
    wbv = openpyxl.load_workbook(xls, data_only=True)
    mapa, excepciones = leer_mapa(wbf)
    esquemas = {'E1': leer_esquema(wbf, wbv, 'ESQUEMA 1', 'E1'), 'E2': leer_esquema(wbf, wbv, 'ESQUEMA 2', 'E2')}

    # rubros: en el orden del Esquema 1, luego los del mapa que falten
    rubros = []
    for f in sorted(esquemas['E1'].values(), key=lambda x: x['fila']):
        if f['tipo'] == 'rubro' and f['rubro'] not in rubros:
            rubros.append(f['rubro'])
    for _, _, r in mapa + [(c, None, r) for c, _, r in excepciones]:
        if r not in rubros:
            rubros.append(r)

    # rubros sin fila en los esquemas: se agregan como filas de detalle dentro de su grupo
    for clave, filas in esquemas.items():
        presentes = {f['rubro'] for f in filas.values() if f['tipo'] == 'rubro'}
        for rub in RUBROS_FALTANTES:
            if rub in presentes:
                continue
            grupo = next(f for f in filas.values() if f['etiqueta'] == rub and f['tipo'] == 'grupo')
            ultimo = max(grupo['hijos'])
            filas[ultimo + 0.5] = {
                'fila': ultimo + 0.5, 'etiqueta': rub, 'nivel': filas[ultimo]['nivel'], 'negrita': False,
                'tipo': 'rubro', 'rubro': rub, 'formula': None, 'hijos': [], 'base': grupo['base'],
                'concepto': None, 'padre': grupo['fila'], 'esperado': None,
            }

    def codigo(n):
        return 'F' + (str(int(n)) if n == int(n) else str(int(n)) + 'b')

    out = []
    w = out.append
    w('-- Generado por scripts/generar_modelo.py desde "Modelo EERR1 incamotors noviembre.xlsx". No editar a mano.')
    w('-- Ejecutar en Supabase › SQL Editor después de supabase/migrations/005_esquemas.sql.')
    w('begin;')
    w('')
    w('-- rubros del reporte')
    w('insert into rubros_eerr (codigo, orden) values')
    w(',\n'.join(f'  ({q(r)}, {i + 1})' for i, r in enumerate(rubros)))
    w('on conflict (codigo) do update set orden = excluded.orden;')
    w('')
    w('-- mapa de cuentas: nombre a mostrar y rubro (uno solo para toda la empresa)')
    w('insert into cuentas (cuenta, nombre, clase, rubro) values')
    w(',\n'.join(f'  ({q(c)}, {q(n)}, {q(c[0])}, {q(r)})' for c, n, r in mapa))
    w('on conflict (cuenta) do update set nombre = excluded.nombre, rubro = excluded.rubro;')
    w('')
    w('-- excepciones por unidad de negocio (cuentas repetidas en el mapa del Excel)')
    w('delete from mapa_excepciones;')
    for c, u, r in excepciones:
        w(f'insert into mapa_excepciones (cuenta, unidad, rubro) values ({q(c)}, {q(u)}, {q(r)});')
    w('')
    w('-- cuentas nuevas de SAP que no están en el mapa del Excel: rubro de una cuenta hermana')
    for c, h in HERMANAS.items():
        w(f'update cuentas set rubro = (select rubro from cuentas where cuenta = {q(h)}) where cuenta = {q(c)} and rubro is null;')
    w('')
    w('-- filas de los esquemas')
    w('delete from esquema_filas;')
    w('insert into esquema_filas (esquema, codigo, orden, etiqueta, nivel, tipo, padre, rubro, formula, base, concepto, negrita) values')
    filas_sql = []
    for clave, filas in esquemas.items():
        for n in sorted(filas):
            f = filas[n]
            padre = f.get('padre')
            filas_sql.append('  (' + ', '.join([
                q(clave), q(codigo(n)), str(int(n * 10)), q(f['etiqueta']), str(f['nivel']), q(f['tipo']),
                q(codigo(padre)) if padre else 'null', q(f['rubro']), arr(f['formula']),
                q(codigo(f['base'])) if f['base'] else 'null', q(f['concepto']), 'true' if f['negrita'] else 'false',
            ]) + ')')
    w(',\n'.join(filas_sql) + ';')
    w('')
    w('-- participaciones e impuesto a la renta del Real 2026 (escritos a mano en el Excel)')
    w('insert into montos_empresa (escenario_id, anio, mes, concepto, monto)')
    vals = [f"({q(f['concepto'])}, {i + 1}, {v})"
            for f in esquemas['E1'].values() if f['tipo'] == 'manual' for i, v in enumerate(f['manual'])]
    w('select e.id, 2026, v.mes, v.concepto, v.monto from escenarios e, (values\n  ' + ',\n  '.join(vals) +
      ') v(concepto, mes, monto)')
    w("where e.codigo = 'REAL_2026'")
    w('on conflict (escenario_id, anio, mes, concepto) do update set monto = excluded.monto;')
    w('')
    w("-- empresa de cada marca: Nova Autos = Chevrolet e Isuzu")
    w("update lineas set empresa = 'NOVA_AUTOS' where codigo ilike 'CHEV%' or nombre ilike '%chevrolet%' or codigo ilike '%ISUZU%' or nombre ilike '%isuzu%';")
    w('')
    w('commit;')
    open(salida, 'w', encoding='utf-8', newline='\n').write('\n'.join(out) + '\n')
    print(f'{salida}: {len(rubros)} rubros, {len(mapa)} cuentas, ' +
          ', '.join(f'{k}={len(v)} filas' for k, v in esquemas.items()))

    if pruebas:
        # montos ene–set por cuenta (soles) y totales esperados por fila, para probar el motor del reporte
        mv = wbv['MAPA DE CUENTAS']
        montos, vistas = [], set()
        for r in range(2, mv.max_row + 1):
            c = mv.cell(r, 1).value
            if c is None:
                continue
            c = str(c)
            unidad = EXCEPCIONES[(c, limpiar(mv.cell(r, 3).value))][0] if c in vistas else 'GEN'
            vistas.add(c)
            montos.append({'cuenta': c, 'unidad': unidad, 'valores': [float(mv.cell(r, k).value or 0) for k in MAPA_COL]})
        json.dump({
            'mapa': {c: r for c, _, r in mapa}, 'excepciones': excepciones, 'montos': montos,
            'esquemas': {k: [{**{x: y for x, y in f.items() if x not in ('hijos',)}, 'codigo': codigo(n),
                              'padre': codigo(f['padre']) if f.get('padre') else None,
                              'base': codigo(f['base']) if f['base'] else None}
                             for n, f in sorted(v.items())] for k, v in esquemas.items()},
        }, open(pruebas, 'w', encoding='utf-8'), ensure_ascii=False, default=str)


if __name__ == '__main__':
    main()
