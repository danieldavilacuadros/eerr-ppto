"""
Genera supabase/seed.sql a partir de los Excel de Incamotors.

Uso:
    python scripts/generar_seed.py <NUEVO_MODELO.xlsx> <ER_X_LINEAS.xlsx>

- NUEVO_MODELO: hoja '2026' -> maestro de cuentas mayores con ERI1/ERI2 (vista contable)
- ER_X_LINEAS : hoja 'FINANCIAMIENTO-AQP' -> plantilla de rubros comerciales (col A = cuentas)
                hoja 'CONTROL SEP.26'     -> combinaciones sede / unidad de negocio / linea (centros)
"""
import sys
import re
import unicodedata
import collections
import openpyxl
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

OUT = Path(__file__).resolve().parent.parent / "supabase" / "seed.sql"


def q(v):
    if v is None:
        return "null"
    return "'" + str(v).replace("'", "''") + "'"


# --------------------------------------------------------------------------- dimensiones
SEDES = [
    ("AQP", "Arequipa", 1), ("CUZ", "Cusco", 2), ("JUL", "Juliaca", 3),
    ("ICA", "Ica", 4), ("TRU", "Trujillo", 5), ("PIU", "Piura", 6),
]

LINEAS_COMERCIALES = [
    ("UNIDADES", "Unidades", 1),
    ("IFE", "Intermediación financiera y equipamiento", 2),
    ("POSVENTA", "Posventa", 3),
    ("LUBRICANTES", "Lubricantes", 4),
    ("SEMINUEVOS", "Seminuevos", 5),
    ("ADMINISTRACION", "Administración / Gastos generales", 6),
]

UNIDADES = [  # codigo SAP, nombre, linea comercial, orden
    ("UNI", "Venta de unidades", "UNIDADES", 1),
    ("CORPORAT", "Ventas corporativas", "UNIDADES", 2),
    ("FINANC", "Intermediación financiera", "IFE", 3),
    ("ACC", "Equipamiento y accesorios", "IFE", 4),
    ("SER", "Taller", "POSVENTA", 5),
    ("REP", "Repuestos", "POSVENTA", 6),
    ("LUB", "Lubricantes", "LUBRICANTES", 7),
    ("U-SEMINU", "Seminuevos", "SEMINUEVOS", 8),
    ("GEN", "Gastos generales", "ADMINISTRACION", 9),
]

LINEAS = {  # codigo SAP de linea/marca -> nombre
    "FOR": "Ford", "HPV": "Hyundai Pasajeros", "HCV": "Hyundai Comerciales", "GEELY": "Geely",
    "MOT": "Motormundo (Geely)", "JMC": "JMC", "BAIC": "BAIC", "NISSAN": "Nissan",
    "DIVEMOTO": "Divemotor", "VOLVO": "Volvo (Línea Premium)", "CHERY": "Chery", "DONG": "Dongfeng",
    "BYD": "BYD", "OMODA": "Omoda", "OMO&JAE": "Omoda & Jaecoo", "JAECCO": "Jaecoo",
    "MITSUBIS": "Mitsubishi", "FUSO": "Fuso", "UNI-SEMI": "Seminuevos", "CORP": "Corporativo",
    "FINANCIA": "Financiamiento", "CAS": "Castrol", "MOB": "Mobil", "HRPTO": "Hyundai Repuestos",
    "OTR-REP": "Otros repuestos", "PYP": "Planchado y pintura", "212": "212", "ADM_TALL": "Administración taller",
    "CAJA": "Caja", "GENERAL": "General", "GERENCIA": "Gerencia",
}

# --------------------------------------------------------------------------- vista contable
# (codigo, nombre, tipo, padre, formula) en orden de presentacion (modelo ERI_SOLES)
CONTABLE = [
    ("C_VENTAS", "VENTAS NETAS", "seccion", None, None),
    ("C_COSTO", "COSTO DE VENTAS Y SERVICIOS", "seccion", None, None),
    ("C_UB", "UTILIDAD BRUTA DE OPERACIÓN", "total", None, ["C_VENTAS", "C_COSTO"]),
    ("C_PERSONAL", "CARGAS DEL PERSONAL", "seccion", None, None),
    ("C_DIETAS", "DIETAS AL DIRECTORIO", "seccion", None, None),
    ("C_SPT", "SERVICIOS PRESTADOS POR TERCEROS", "seccion", None, None),
    ("C_TRIB", "TRIBUTOS", "seccion", None, None),
    ("C_GESTION", "GASTOS DE GESTIÓN", "seccion", None, None),
    ("C_DEPRE", "DEPRECIACION Y AMORTIZACION", "seccion", None, None),
    ("C_COBDUD", "COBRANZA DUDOSA", "seccion", None, None),
    ("C_UO", "UTILIDAD DE OPERACIÓN", "total", None,
     ["C_UB", "C_PERSONAL", "C_DIETAS", "C_SPT", "C_TRIB", "C_GESTION", "C_DEPRE", "C_COBDUD"]),
    ("C_EBITDA", "EBITDA", "total", None, ["C_UO", "-C_DEPRE"]),
    ("C_ENAJ", "ENAJENACION DE ACTIVOS FIJOS (neto)", "seccion", None, None),
    ("C_INGFIN", "INGRESOS FINANCIEROS", "seccion", None, None),
    ("C_GASFIN", "GASTOS FINANCIEROS", "seccion", None, None),
    ("C_OIG", "OTROS INGRESOS Y GASTOS", "seccion", None, None),
    ("C_DIFCAM", "DIFERENCIA DE CAMBIO (neto)", "seccion", None, None),
    ("C_RES", "RESULTADO DEL EJERCICIO", "total", None,
     ["C_UO", "C_ENAJ", "C_INGFIN", "C_GASFIN", "C_OIG", "C_DIFCAM"]),
]

# ERI2 que el modelo ERI_SOLES presenta en una seccion distinta a su ERI1
ERI2_SECCION_ESPECIAL = {
    "COMISION INTERMEDIACION FINANCIERA": "C_VENTAS",
    "TRAMITE DE PLACAS": "C_VENTAS",
    "ALQUILER DE UNIDADES": "C_VENTAS",
    "INCENTIVO FUERZA DE VENTAS": "C_PERSONAL",
    "MARKETING APOYO DE MARCA": "C_SPT",
    "COSTO DE VENTAS Y SERVICIOS": "C_COSTO",
}
ERI1_SECCION = {
    "INGRESOS POR VENTAS Y SERVICIOS": "C_VENTAS",
    "COSTO DE VENTAS Y SERVICIOS": "C_COSTO",
    "CARGAS DEL PERSONAL": "C_PERSONAL",
    "DIETAS AL DIRECTORIO": "C_DIETAS",
    "SERVICIOS PRESTADOS POR TERCEROS": "C_SPT",
    "TRIBUTOS": "C_TRIB",
    "GASTOS DE GESTIÓN": "C_GESTION",
    "DEPRECIACION Y AMORTIZACION": "C_DEPRE",
    "PROVISION COBRANZA DUDOSA": "C_COBDUD",
    "DESVALORIZACION EXISTENCIAS": "C_OIG",
    "ENAJENACION DE ACTIVOS FIJOS (neto)": "C_ENAJ",
    "INGRESOS FINANCIEROS": "C_INGFIN",
    "GASTOS FINANCIEROS": "C_GASFIN",
    "OTROS INGRESOS Y GASTOS": "C_OIG",
    "DIFERENCIA DE CAMBIO (neto)": "C_DIFCAM",
}

# --------------------------------------------------------------------------- vista comercial
# Secciones / totales del ER por linea de negocio. Los detalles salen de la plantilla Excel.
COMERCIAL_SECCIONES = [
    # (codigo seccion, nombre, rango de filas de la plantilla FINANCIAMIENTO-AQP)
    ("M_VENTAS", "VENTAS NETAS", (11, 14)),
    ("M_COSTO", "COSTO DE VENTAS", (16, 17)),
    ("M_MB", "MARGEN BRUTO", ["M_VENTAS", "M_COSTO"]),
    ("M_FLETES", "FLETES Y DISTRIBUCIÓN", (20, 21)),
    ("M_MN", "MARGEN NETO", ["M_MB", "M_FLETES"]),
    ("M_OTROS", "OTROS INGRESOS / EGRESOS", (25, 31)),
    ("M_IB", "TOTAL INGRESO BRUTO", ["M_MN", "M_OTROS"]),
    ("M_GDF", "GASTOS DIRECTOS FIJOS", (35, 63)),
    ("M_GDV", "GASTOS DIRECTOS VARIABLES", (65, 69)),
    ("M_ROD", "RESULTADO OPERATIVO DIRECTO", ["M_IB", "M_GDF", "M_GDV"]),
    ("M_GI", "GASTOS INDIRECTOS", (75, 84)),
    ("M_OIG", "OTROS INGRESOS Y GASTOS", (86, 89)),
    ("M_RO", "RESULTADO OPERATIVO", ["M_ROD", "M_GI", "M_OIG"]),
    ("M_GG", "GASTOS GENERALES Y PROVISIONES", (93, 97)),
    ("M_RON", "RESULTADO OPERATIVO NETO", ["M_RO", "M_GG"]),
]

# Reglas por familia (prefijo) para cuentas que no figuran explicitamente en la plantilla
REGLAS_FAMILIA = [
    ("701", "Ventas"), ("709", "Ventas"), ("702", "Ventas"), ("703", "Ventas"),
    ("704", "Ventas Accesorios"), ("73", "Descuentos, Rebajas y Bonificaciones Obtenidas"),
    ("741", "Descuentos, Rebajas y Bonificaciones Concedidas"),
    ("691", "(-) Costo de ventas"), ("692", "(-) Costo de ventas"), ("694", "(-) Costo de ventas"),
    ("695", "(-) Costo de ventas"), ("696", "(-) Costo de ventas"),
    ("634", "Reparación y Mantenimiento"), ("627", "Impuestos y Gastos Legales directos"),
    ("623", "Sueldos"), ("6382", "SERVICIOS VARIOS"), ("6793", "Alquileres"), ("6831", "Alquileres"),
    ("6871", "Provisión Cobranza Dudosa (gg)"), ("6", "Otros gastos"), ("7", "Ingresos varios"),
]


def slug(s, n=28):
    s = unicodedata.normalize("NFKD", s.upper()).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Z0-9]+", "_", s).strip("_")[:n]


def main(nuevo, er):
    wb_n = openpyxl.load_workbook(nuevo, read_only=True, data_only=True)
    wb_e = openpyxl.load_workbook(er, read_only=True, data_only=True)

    # ---- cuentas
    cuentas = collections.OrderedDict()
    cuenta_eri = collections.defaultdict(list)
    for r in wb_n["2026"].iter_rows(min_row=2, max_col=5, values_only=True):
        if r[0] is None:
            continue
        c = str(r[0]).strip()
        nombre, eri1, eri2 = [(x or "").strip() for x in r[1:4]]
        total = r[4] or 0
        cuenta_eri[c].append((eri1, eri2, abs(total)))
        if c not in cuentas:
            cuentas[c] = nombre

    # ---- rubros contables
    rubros = []  # (vista, codigo, nombre, tipo, padre, formula, orden)
    orden = 0
    detalle_contable = collections.OrderedDict()  # eri2 -> codigo detalle
    secciones_det = collections.defaultdict(list)
    for c, lst in cuenta_eri.items():
        for eri1, eri2, _ in lst:
            sec = ERI2_SECCION_ESPECIAL.get(eri2) or ERI1_SECCION.get(eri1)
            if not sec:
                print("!! ERI1 sin seccion:", eri1, eri2)
                sec = "C_OIG"
            key = (sec, eri2)
            if key not in detalle_contable:
                detalle_contable[key] = "CD_" + slug(eri2, 40) + ("_" + sec[2:6] if sec == "C_COSTO" else "")
                secciones_det[sec].append(key)
    for codigo, nombre, tipo, padre, formula in CONTABLE:
        orden += 10
        rubros.append(("contable", codigo, nombre, tipo, None, formula, orden))
        for key in secciones_det.get(codigo, []):
            orden += 1
            rubros.append(("contable", detalle_contable[key], key[1], "detalle", codigo, None, orden))

    mapeos = []  # (vista, cuenta, unidad, rubro)
    for c, lst in cuenta_eri.items():
        lst_sorted = sorted(lst, key=lambda x: -x[2])
        for i, (eri1, eri2, _) in enumerate(lst_sorted):
            sec = ERI2_SECCION_ESPECIAL.get(eri2) or ERI1_SECCION.get(eri1) or "C_OIG"
            rub = detalle_contable[(sec, eri2)]
            if len(lst_sorted) == 1:
                mapeos.append(("contable", c, None, rub))
            elif eri2 == "INCENTIVO FUERZA DE VENTAS":
                mapeos.append(("contable", c, "UNI", rub))
            else:
                mapeos.append(("contable", c, None, rub))

    # ---- rubros comerciales desde la plantilla
    ws = wb_e["FINANCIAMIENTO-AQP"]
    filas = {}
    for i, r in enumerate(ws.iter_rows(min_row=1, max_row=100, max_col=2, values_only=True), 1):
        filas[i] = (str(r[0]).strip() if r[0] is not None else "", (r[1] or "").strip())
    comercial_det = {}  # nombre -> codigo
    explicitos = {}
    usados = set()
    for codigo, nombre, spec in COMERCIAL_SECCIONES:
        orden += 10
        if isinstance(spec, list):
            rubros.append(("comercial", codigo, nombre, "total", None, spec, orden))
            continue
        rubros.append(("comercial", codigo, nombre, "seccion", None, None, orden))
        for f in range(spec[0], spec[1] + 1):
            a, b = filas.get(f, ("", ""))
            if not b or b.upper().startswith(("TOTAL", "MARGEN")) or a in ("%", "MB", "MN"):
                continue
            nombre_det = b.title() if b.isupper() else b
            if nombre_det in comercial_det:  # nombres repetidos (Tramite de Placas, Apoyo de marca)
                nombre_det = f"{nombre_det} ({codigo[2:].lower()})"
            cod = "MD_" + slug(b, 40)
            while cod in usados:
                cod += "_"
            usados.add(cod)
            orden += 1
            rubros.append(("comercial", cod, nombre_det, "detalle", codigo, None, orden))
            comercial_det[nombre_det] = cod
            comercial_det.setdefault(b, cod)
            for cta in re.split(r"[,\s]+", a):
                if re.fullmatch(r"\d{7}", cta) and cta not in explicitos:
                    explicitos[cta] = cod
    alias = {nombre: comercial_det.get(nombre) for _, nombre in REGLAS_FAMILIA}
    missing = [k for k, v in alias.items() if not v]
    if missing:
        print("!! alias sin rubro:", missing, sorted(comercial_det))

    por4 = {}
    for cta, cod in explicitos.items():
        por4.setdefault(cta[:4], cod)
    sin = []
    for c in cuentas:
        if c in explicitos:
            rub = explicitos[c]
        elif c[:4] in por4 and not c.startswith(("70", "69", "74")):
            rub = por4[c[:4]]
        else:
            rub = next(alias[r] for p, r in REGLAS_FAMILIA if c.startswith(p))
            if rub in (alias["Otros gastos"], alias["Ingresos varios"]):
                sin.append((c, cuentas[c], rub))
        mapeos.append(("comercial", c, None, rub))
    # En taller los servicios 704 son "Ventas" del taller
    for c in cuentas:
        if c.startswith("704") and c not in ("7041012",):
            mapeos.append(("comercial", c, "SER", alias["Ventas"]))

    print(f"cuentas={len(cuentas)} rubros={len(rubros)} mapeos={len(mapeos)}")
    print("Cuentas asignadas por regla general (revisar):")
    for x in sin:
        print("  ", x)

    # ---- centros (sede, unidad, linea) desde CONTROL
    centros = set()
    for r in wb_e["CONTROL SEP.26"].iter_rows(min_row=20, max_col=4, values_only=True):
        if not r[0] or not r[1] or not r[2] or not r[3]:
            continue
        if "," in r[1] or "," in r[2] or "," in r[3] or r[0] == "(sin hoja)":
            continue
        centros.add((r[1], r[2], r[3]))
    for s, *_ in SEDES:
        centros.add((s, "GEN", "GENERAL"))
        centros.add((s, "FINANC", "FINANCIA"))
    centros = sorted(centros)

    # ---- tipo de cambio mensual 2026 (fila 5 de las hojas del ER, columnas R..AC)
    tc = []
    for i, r in enumerate(wb_e["FINANCIAMIENTO-AQP"].iter_rows(min_row=5, max_row=5, min_col=18, max_col=29, values_only=True)):
        for m, v in enumerate(r, 1):
            if isinstance(v, (int, float)) and v > 0:
                tc.append((2026, m, round(v, 4)))

    # ---- escribir SQL
    L = ["-- Generado por scripts/generar_seed.py. No editar a mano.", "begin;", ""]
    L.append("insert into sedes (codigo, nombre, orden) values")
    L.append(",\n".join(f"  ({q(a)}, {q(b)}, {o})" for a, b, o in SEDES) + "\non conflict (codigo) do nothing;\n")
    L.append("insert into lineas_comerciales (codigo, nombre, orden) values")
    L.append(",\n".join(f"  ({q(a)}, {q(b)}, {o})" for a, b, o in LINEAS_COMERCIALES) + "\non conflict (codigo) do nothing;\n")
    L.append("insert into unidades_negocio (codigo, nombre, linea_comercial, orden) values")
    L.append(",\n".join(f"  ({q(a)}, {q(b)}, {q(c)}, {o})" for a, b, c, o in UNIDADES) + "\non conflict (codigo) do nothing;\n")
    lineas_usadas = sorted({c[2] for c in centros} | set(LINEAS))
    L.append("insert into lineas (codigo, nombre) values")
    L.append(",\n".join(f"  ({q(a)}, {q(LINEAS.get(a, a))})" for a in lineas_usadas) + "\non conflict (codigo) do nothing;\n")
    L.append("insert into centros (sede, unidad, linea) values")
    L.append(",\n".join(f"  ({q(a)}, {q(b)}, {q(c)})" for a, b, c in centros) + "\non conflict do nothing;\n")
    L.append("insert into cuentas (cuenta, nombre, clase) values")
    L.append(",\n".join(f"  ({q(c)}, {q(n)}, {q(c[:1])})" for c, n in cuentas.items()) + "\non conflict (cuenta) do nothing;\n")
    L.append("insert into cuentas (cuenta, nombre, clase, es_estadistica) values")
    L.append("  ('VOL', 'VOLUMEN (unidades / litros)', 'E', true)\non conflict (cuenta) do nothing;\n")
    L.append("insert into rubros (vista, codigo, nombre, tipo, padre, formula, orden) values")
    vals = []
    for vista, cod, nom, tipo, padre, formula, o in rubros:
        f = "null" if not formula else "array[" + ",".join(q(x) for x in formula) + "]"
        vals.append(f"  ({q(vista)}, {q(cod)}, {q(nom)}, {q(tipo)}, {q(padre)}, {f}, {o})")
    L.append(",\n".join(vals) + "\non conflict (vista, codigo) do nothing;\n")
    L.append("insert into mapeo_cuentas (vista, cuenta, unidad, rubro) values")
    L.append(",\n".join(f"  ({q(v)}, {q(c)}, {q(u)}, {q(r)})" for v, c, u, r in mapeos) + "\non conflict do nothing;\n")
    if tc:
        L.append("insert into tipo_cambio (anio, mes, tc) values")
        L.append(",\n".join(f"  ({a}, {m}, {t})" for a, m, t in tc) + "\non conflict (anio, mes) do nothing;\n")
    L.append("insert into escenarios (codigo, nombre, anio, tipo, estado) values")
    L.append("  ('REAL_2026', 'Real 2026', 2026, 'real', 'cerrado'),\n"
             "  ('REAL_2027', 'Real 2027', 2027, 'real', 'cerrado'),\n"
             "  ('PPTO_2027', 'Presupuesto 2027', 2027, 'ppto', 'abierto')\non conflict (codigo) do nothing;\n")
    L.append("commit;")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(L), encoding="utf-8")
    print("->", OUT)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
