import type { FilaReporte } from './reporte'

/** Factor de distribución de gastos generales (GG) o exposición al tipo de cambio (TC). */
export interface FactorDist {
  anio: number
  mes: number
  concepto: 'GG' | 'TC'
  sede: string | null
  unidad: string
  linea: string | null
  factor: number
}

export type Concepto = 'INGRESOS' | 'COSTOS' | 'GASTOS' | 'GASTOS_INDIRECTOS' | 'OTROS' | 'PROVISIONES' | 'NO_INCLUIR'
export const CONCEPTOS: { codigo: Concepto; nombre: string }[] = [
  { codigo: 'INGRESOS', nombre: 'Ingresos' },
  { codigo: 'COSTOS', nombre: 'Costos' },
  { codigo: 'GASTOS', nombre: 'Gastos (hasta margen de contribución)' },
  { codigo: 'GASTOS_INDIRECTOS', nombre: 'Gastos indirectos' },
  { codigo: 'OTROS', nombre: 'Otros ingresos y gastos' },
  { codigo: 'PROVISIONES', nombre: 'Provisiones y diferencia de cambio' },
  { codigo: 'NO_INCLUIR', nombre: 'No incluir' },
]
/** Agrupación por defecto (la tabla consolidado_secciones la reemplaza si existe). */
export const AGRUPACION_DEFECTO: Record<string, Concepto> = {
  M_VENTAS: 'INGRESOS', M_OTROS: 'INGRESOS', M_COSTO: 'COSTOS',
  M_FLETES: 'GASTOS', M_GDF: 'GASTOS', M_GDV: 'GASTOS',
  M_GI: 'GASTOS_INDIRECTOS', M_OIG: 'OTROS', M_GG: 'PROVISIONES',
}

const sumar = (...xs: number[][]) => xs[0].map((_, i) => xs.reduce((t, x) => t + (x[i] ?? 0), 0))

/**
 * Vista consolidada a partir del reporte comercial, según la agrupación de secciones:
 * Ingresos, Costos, Margen bruto, Gastos, Margen de contribución
 * (y en la vista general: gastos indirectos, otros, resultado operativo, reparto de gastos generales y RON).
 */
export function filasConsolidadas(filas: FilaReporte[], n: number, opciones: {
  agrupacion?: Record<string, Concepto>; hastaRON?: boolean; distGG?: number[]; distTC?: number[]
} = {}): FilaReporte[] {
  const agr = opciones.agrupacion ?? AGRUPACION_DEFECTO
  const cero = () => new Array(n).fill(0) as number[]
  const tot = (c: Concepto) => {
    const v = cero()
    for (const f of filas) if (f.tipo === 'seccion' && agr[f.clave] === c) f.valores.forEach((x, i) => { v[i] += x })
    return v
  }
  const ingresos = tot('INGRESOS'), costos = tot('COSTOS')
  const mb = sumar(ingresos, costos)
  const gastos = tot('GASTOS')
  const mc = sumar(mb, gastos)
  const out: FilaReporte[] = [
    { clave: 'C_ING', tipo: 'detalle', nombre: 'Ingresos', valores: ingresos },
    { clave: 'C_COS', tipo: 'detalle', nombre: 'Costos', valores: costos },
    { clave: 'C_MB', tipo: 'total', nombre: 'MARGEN BRUTO', valores: mb },
    { clave: 'C_GAS', tipo: 'detalle', nombre: 'Gastos', valores: gastos },
    { clave: 'C_MC', tipo: 'total', nombre: 'MARGEN DE CONTRIBUCIÓN', valores: mc },
  ]
  if (!opciones.hastaRON) return out
  const gi = tot('GASTOS_INDIRECTOS'), oig = tot('OTROS'), prov = tot('PROVISIONES')
  const ro = sumar(mc, gi, oig)
  const dGG = opciones.distGG ?? cero(), dTC = opciones.distTC ?? cero()
  out.push(
    { clave: 'C_GI', tipo: 'detalle', nombre: 'Gastos indirectos', valores: gi },
    { clave: 'C_OIG', tipo: 'detalle', nombre: 'Otros ingresos y gastos', valores: oig },
    { clave: 'C_RO', tipo: 'total', nombre: 'RESULTADO OPERATIVO', valores: ro },
    { clave: 'C_GGP', tipo: 'detalle', nombre: 'Provisiones y diferencia de cambio propias', valores: prov },
    { clave: 'C_DGG', tipo: 'detalle', nombre: 'Gastos generales distribuidos (factor)', valores: dGG },
    { clave: 'C_DTC', tipo: 'detalle', nombre: 'Exposición al tipo de cambio distribuida (factor)', valores: dTC },
    { clave: 'C_RON', tipo: 'total', nombre: 'RESULTADO OPERATIVO NETO', valores: sumar(ro, prov, dGG, dTC) },
  )
  return out
}

/**
 * Reparte gastos generales y exposición al tipo de cambio a cada línea comercial.
 * monto = factor × ingresos del alcance del factor, mes a mes.
 * Si un mes no tiene factor, usa el último factor disponible del mismo alcance (aproximado).
 * La línea comercial de gastos generales recibe el negativo de lo repartido (no cambia el total).
 */
export function distribuir(opts: {
  factores: FactorDist[]
  meses: number[]
  base: Map<string, number>                                 // `${mes}|${sede}|${unidad}|${linea}` -> ingresos
  lcDeUnidad: (unidad: string) => string
  lcAdministracion: string
  sede?: string
}): { gg: Map<string, number>; tc: Map<string, number> } {
  const { factores, meses, base, lcDeUnidad, lcAdministracion, sede } = opts
  const gg = new Map<string, number>(), tc = new Map<string, number>()
  const sumarA = (m: Map<string, number>, k: string, x: number) => m.set(k, (m.get(k) ?? 0) + x)
  const alcances = new Map<string, { f: FactorDist; porMes: Map<number, number> }>()
  for (const f of factores) {
    const k = `${f.concepto}|${f.sede ?? ''}|${f.unidad}|${f.linea ?? ''}`
    if (!alcances.has(k)) alcances.set(k, { f, porMes: new Map() })
    alcances.get(k)!.porMes.set(f.mes, Number(f.factor))
  }
  const claves = [...base.keys()].map(k => { const [m, se, u, l] = k.split('|'); return { k, m: Number(m), se, u, l } })
  for (const { f, porMes } of alcances.values()) {
    const unidades = f.unidad === 'UNI' ? ['UNI', 'ACC'] : [f.unidad]
    for (const m of meses) {
      let factor = porMes.get(m)
      if (factor == null) {
        const prev = [...porMes.keys()].filter(x => x < m).sort((a, b) => b - a)[0]
        if (prev == null) continue
        factor = porMes.get(prev)!
      }
      let b = 0
      for (const c of claves) {
        if (c.m !== m) continue
        if (f.sede && c.se !== f.sede) continue
        if (sede && c.se !== sede) continue
        if (!unidades.includes(c.u)) continue
        if (f.linea && c.l !== f.linea) continue
        b += base.get(c.k)!
      }
      const monto = factor * b
      if (!monto) continue
      const destino = f.concepto === 'GG' ? gg : tc
      sumarA(destino, lcDeUnidad(f.unidad), monto)
      sumarA(destino, lcAdministracion, -monto)
    }
  }
  return { gg, tc }
}
