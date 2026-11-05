import type { Cuenta, Rubro, Vista } from './tipos'

export interface Entrada {
  cuenta: string
  unidad: string
  valores: number[]
}

export interface FilaReporte {
  clave: string
  tipo: 'seccion' | 'detalle' | 'total' | 'cuenta' | 'sin'
  nombre: string
  valores: number[]
  rubro?: string
  cuenta?: string
}

export const SIN_CLASIFICAR = '__SIN'

const sumar = (a: number[], b: number[], signo = 1) => { for (let i = 0; i < a.length; i++) a[i] += signo * (b[i] ?? 0) }

/**
 * Arma un estado de resultados (contable o comercial) a partir de montos por cuenta.
 * Cada entrada trae N columnas de valores (meses, escenarios, etc.); el reporte respeta esas N columnas.
 */
export function construirReporte(opts: {
  rubros: Rubro[]
  vista: Vista
  resolver: (cuenta: string, unidad: string) => string | null
  cuentas: Map<string, Cuenta>
  entradas: Entrada[]
  columnas: number
  conCuentas: boolean
}): { filas: FilaReporte[]; totalGeneral: number[]; sinClasificar: number[] } {
  const { rubros, vista, resolver, cuentas, entradas, columnas: n, conCuentas } = opts
  const vacio = () => new Array(n).fill(0) as number[]
  const lista = rubros.filter(r => r.vista === vista).sort((a, b) => a.orden - b.orden)

  const porRubro = new Map<string, number[]>()
  const porRubroCuenta = new Map<string, Map<string, number[]>>()
  const totalGeneral = vacio()

  for (const e of entradas) {
    if (cuentas.get(e.cuenta)?.es_estadistica) continue
    const r = resolver(e.cuenta, e.unidad) ?? SIN_CLASIFICAR
    if (!porRubro.has(r)) porRubro.set(r, vacio())
    sumar(porRubro.get(r)!, e.valores)
    sumar(totalGeneral, e.valores)
    if (conCuentas) {
      if (!porRubroCuenta.has(r)) porRubroCuenta.set(r, new Map())
      const m = porRubroCuenta.get(r)!
      if (!m.has(e.cuenta)) m.set(e.cuenta, vacio())
      sumar(m.get(e.cuenta)!, e.valores)
    }
  }

  // valores de secciones y totales
  const valor = new Map<string, number[]>()
  for (const r of lista) if (r.tipo === 'detalle') valor.set(r.codigo, porRubro.get(r.codigo) ?? vacio())
  for (const r of lista) {
    if (r.tipo !== 'seccion') continue
    const v = vacio()
    for (const d of lista) if (d.padre === r.codigo) sumar(v, valor.get(d.codigo)!)
    valor.set(r.codigo, v)
  }
  const evaluar = (codigo: string, pila: Set<string>): number[] => {
    if (valor.has(codigo)) return valor.get(codigo)!
    const r = lista.find(x => x.codigo === codigo)
    const v = vacio()
    if (r?.formula && !pila.has(codigo)) {
      pila.add(codigo)
      for (const ref of r.formula) {
        const neg = ref.startsWith('-')
        sumar(v, evaluar(neg ? ref.slice(1) : ref, pila), neg ? -1 : 1)
      }
    }
    valor.set(codigo, v)
    return v
  }
  for (const r of lista) if (r.tipo === 'total') evaluar(r.codigo, new Set())

  const filas: FilaReporte[] = []
  const filasCuentas = (rubro: string) => {
    if (!conCuentas) return
    const m = porRubroCuenta.get(rubro)
    if (!m) return
    for (const [cta, v] of [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      filas.push({ clave: `${rubro}/${cta}`, tipo: 'cuenta', nombre: cuentas.get(cta)?.nombre ?? cta, valores: v, rubro, cuenta: cta })
    }
  }
  for (const r of lista) {
    if (r.tipo === 'detalle') continue
    filas.push({ clave: r.codigo, tipo: r.tipo, nombre: r.nombre, valores: valor.get(r.codigo)!, rubro: r.codigo })
    if (r.tipo === 'seccion') {
      for (const d of lista) {
        if (d.padre !== r.codigo) continue
        filas.push({ clave: d.codigo, tipo: 'detalle', nombre: d.nombre, valores: valor.get(d.codigo)!, rubro: d.codigo })
        filasCuentas(d.codigo)
      }
    }
  }
  const sin = porRubro.get(SIN_CLASIFICAR) ?? vacio()
  if (sin.some(x => Math.abs(x) > 0.005)) {
    filas.push({ clave: SIN_CLASIFICAR, tipo: 'sin', nombre: 'CUENTAS SIN CLASIFICAR (asignar en Mapeo de cuentas)', valores: sin, rubro: SIN_CLASIFICAR })
    filasCuentas(SIN_CLASIFICAR)
  }
  return { filas, totalGeneral, sinClasificar: sin }
}
