import type { Cuenta, FilaEsquema } from './tipos'

/** Montos de una cuenta en N columnas (meses, totales…), con signo de resultado: ingresos (+), gastos (−). */
export interface Entrada {
  cuenta: string
  unidad?: string
  valores: number[]
}

/** Rubro de una cuenta: el del mapa, salvo excepción para la unidad de negocio. */
export function crearRubroDe(cuentas: Map<string, Cuenta>, excepciones: { cuenta: string; unidad: string; rubro: string }[]) {
  const exc = new Map(excepciones.map(e => [`${e.cuenta}|${e.unidad}`, e.rubro]))
  return (cuenta: string, unidad?: string): string | null =>
    (unidad ? exc.get(`${cuenta}|${unidad}`) : undefined) ?? cuentas.get(cuenta)?.rubro ?? null
}

export interface FilaEERR {
  clave: string
  tipo: FilaEsquema['tipo'] | 'cuenta' | 'sin'
  etiqueta: string
  nivel: number
  negrita: boolean
  valores: number[]
  /** valores de la fila base del % (ventas netas o ingreso de la línea) */
  base: number[] | null
  rubro?: string
  cuenta?: string
}

export const SIN_RUBRO = '__SIN'
export const CONCEPTOS_EMPRESA = { PARTICIPACIONES: 'Participaciones de empleados', IR_DIFERIDO: 'Impuesto a la renta diferido', IR_CORRIENTE: 'Impuesto a la renta corriente' } as const

const sumar = (a: number[], b: number[], signo = 1) => { for (let i = 0; i < a.length; i++) a[i] += signo * (b[i] ?? 0) }

/**
 * Arma el estado de resultados con la forma de un esquema (Excel "ESQUEMA 1" / "ESQUEMA 2").
 * Las cuentas suman en su rubro; los grupos suman sus filas hijas; las fórmulas suman/restan otras filas;
 * las filas manuales (participaciones, impuesto a la renta) toman los montos de la empresa si se pasan.
 * Las cuentas sin rubro, o con un rubro que el esquema no usa, quedan fuera de los totales y se listan al final.
 */
export function construirEsquema(opts: {
  filas: FilaEsquema[]
  esquema: string
  cuentas: Map<string, Cuenta>
  rubroDe: (cuenta: string, unidad?: string) => string | null
  entradas: Entrada[]
  columnas: number
  conCuentas?: boolean
  manual?: Map<string, number[]> | null
}): { filas: FilaEERR[]; sinRubro: number[] } {
  const { cuentas, rubroDe, entradas, columnas: n, conCuentas = false, manual } = opts
  const vacio = () => new Array(n).fill(0) as number[]
  const lista = opts.filas.filter(f => f.esquema === opts.esquema).sort((a, b) => a.orden - b.orden)
  const rubrosUsados = new Set(lista.filter(f => f.tipo === 'rubro').map(f => f.rubro!))

  const porRubro = new Map<string, number[]>()
  const porRubroCuenta = new Map<string, Map<string, number[]>>()
  for (const e of entradas) {
    if (cuentas.get(e.cuenta)?.es_estadistica) continue
    const rd = rubroDe(e.cuenta, e.unidad)
    const r = rd && rubrosUsados.has(rd) ? rd : SIN_RUBRO
    if (!porRubro.has(r)) porRubro.set(r, vacio())
    sumar(porRubro.get(r)!, e.valores)
    if (conCuentas || r === SIN_RUBRO) {
      if (!porRubroCuenta.has(r)) porRubroCuenta.set(r, new Map())
      const m = porRubroCuenta.get(r)!
      if (!m.has(e.cuenta)) m.set(e.cuenta, vacio())
      sumar(m.get(e.cuenta)!, e.valores)
    }
  }

  const porCodigo = new Map(lista.map(f => [f.codigo, f]))
  const hijos = new Map<string, FilaEsquema[]>()
  for (const f of lista) if (f.padre) { if (!hijos.has(f.padre)) hijos.set(f.padre, []); hijos.get(f.padre)!.push(f) }

  const memo = new Map<string, number[]>()
  const valor = (codigo: string, pila = new Set<string>()): number[] => {
    if (memo.has(codigo)) return memo.get(codigo)!
    const f = porCodigo.get(codigo)
    let v = vacio()
    if (f && !pila.has(codigo)) {
      pila.add(codigo)
      if (f.tipo === 'rubro') v = [...(porRubro.get(f.rubro!) ?? vacio())]
      else if (f.tipo === 'grupo') for (const h of hijos.get(codigo) ?? []) sumar(v, valor(h.codigo, pila))
      else if (f.tipo === 'formula') for (const ref of f.formula ?? []) {
        const neg = ref.startsWith('-')
        sumar(v, valor(neg ? ref.slice(1) : ref, pila), neg ? -1 : 1)
      }
      else if (f.tipo === 'manual') v = [...(manual?.get(f.concepto ?? '') ?? vacio())]
      else if (f.tipo === 'pct') {
        const [a, b] = (f.formula ?? []).map(x => valor(x, pila))
        v = v.map((_, i) => (a && b && b[i] ? a[i] / Math.abs(b[i]) : NaN))
      }
      pila.delete(codigo)
    }
    memo.set(codigo, v)
    return v
  }

  const filas: FilaEERR[] = []
  for (const f of lista) {
    const base = f.tipo === 'pct' ? null : f.base ? valor(f.base) : null
    filas.push({
      clave: f.codigo, tipo: f.tipo, etiqueta: f.etiqueta ?? '%', nivel: f.nivel, negrita: f.negrita,
      valores: valor(f.codigo), base, rubro: f.rubro ?? undefined,
    })
    if (conCuentas && f.tipo === 'rubro') {
      const m = porRubroCuenta.get(f.rubro!)
      for (const [cta, v] of [...(m?.entries() ?? [])].sort((a, b) => a[0].localeCompare(b[0]))) {
        filas.push({ clave: `${f.codigo}/${cta}`, tipo: 'cuenta', etiqueta: cuentas.get(cta)?.nombre ?? cta, nivel: f.nivel + 1,
          negrita: false, valores: v, base, rubro: f.rubro ?? undefined, cuenta: cta })
      }
    }
  }
  const sin = porRubro.get(SIN_RUBRO) ?? vacio()
  if (sin.some(x => Math.abs(x) > 0.005)) {
    filas.push({ clave: SIN_RUBRO, tipo: 'sin', etiqueta: 'CUENTAS SIN RUBRO (no suman; asignar en Mapeo de cuentas)', nivel: 0, negrita: true, valores: sin, base: null })
    for (const [cta, v] of [...(porRubroCuenta.get(SIN_RUBRO)?.entries() ?? [])].sort((a, b) => a[0].localeCompare(b[0]))) {
      filas.push({ clave: `${SIN_RUBRO}/${cta}`, tipo: 'cuenta', etiqueta: cuentas.get(cta)?.nombre ?? cta, nivel: 1, negrita: false, valores: v, base: null, cuenta: cta })
    }
  }
  return { filas, sinRubro: sin }
}

/**
 * Agrupación como en el Excel: una fila oculta las siguientes de mayor nivel hasta la próxima de su nivel o menor.
 * Devuelve las filas visibles según los plegados y el nivel máximo mostrado (botones 1, 2, 3… del Excel).
 */
export function filasVisibles<T extends { clave: string; nivel: number }>(filas: T[], plegados: Set<string>, nivelMax = 99) {
  const out: { fila: T; tieneHijos: boolean }[] = []
  let ocultarHasta: number | null = null
  filas.forEach((f, i) => {
    const tieneHijos = (filas[i + 1]?.nivel ?? -1) > f.nivel
    if (ocultarHasta != null) {
      if (f.nivel > ocultarHasta) return
      ocultarHasta = null
    }
    if (f.nivel > nivelMax) return
    out.push({ fila: f, tieneHijos })
    if (tieneHijos && (plegados.has(f.clave) || f.nivel >= nivelMax)) ocultarHasta = f.nivel
  })
  return out
}
