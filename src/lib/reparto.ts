import { ceros, suma } from './formato'
import type { Cuenta } from './tipos'

/** Signo con el que se presenta una cuenta: ingresos (+), gastos (−). */
export const signoCuenta = (c: Cuenta | undefined) => (c?.clase === '6' ? -1 : 1)

export const r2 = (x: number) => Math.round(x * 100) / 100

/** Signo del rubro para digitar en positivo: el de sus cuentas (gastos −1); si mezcla ingresos y gastos, +1. */
export const signoRubro = (ctas: (Cuenta | undefined)[]) => (ctas.length && ctas.every(c => c?.clase === '6') ? -1 : 1)

/**
 * Reparte un monto del rubro (digitado en positivo) entre sus cuentas en un mes: en proporción a lo que ya tienen
 * presupuestado ese mes; si no hay, al real del año anterior de ese mes; si no, al real del año; si no, a la primera.
 */
export function repartirRubro(m: Map<string, number[]>, ref: Map<string, number[]>, ctas: string[], cuentas: Map<string, Cuenta>, mes: number, objetivo: number) {
  if (!ctas.length) return
  const sR = signoRubro(ctas.map(c => cuentas.get(c)))
  const pres = (c: string, v: number) => v * signoCuenta(cuentas.get(c)) // a signo de resultado
  // pesos con signo de resultado (en un rubro mixto, como enajenación, cada cuenta conserva su signo);
  // si se anulan entre sí, en valor absoluto
  const pesosDe = (f: (c: string) => number) => {
    const p = ctas.map(c => f(c))
    return Math.abs(suma(p)) > 0.005 ? p : p.map(Math.abs)
  }
  let pesos = pesosDe(c => pres(c, m.get(c)?.[mes] ?? 0))
  if (!suma(pesos)) pesos = pesosDe(c => pres(c, ref.get(c)?.[mes] ?? 0))
  if (!suma(pesos)) pesos = pesosDe(c => pres(c, suma(ref.get(c) ?? [])))
  if (!suma(pesos)) pesos = ctas.map((_, i) => (i === 0 ? 1 : 0))
  const total = suma(pesos)
  const presObjetivo = objetivo * sR
  let acum = 0
  const abs = pesos.map(Math.abs)
  const mayor = abs.indexOf(Math.max(...abs))
  ctas.forEach((c, i) => {
    const arr = [...(m.get(c) ?? ceros())]
    arr[mes] = r2(presObjetivo * pesos[i] / total * signoCuenta(cuentas.get(c)))
    acum += arr[mes] * signoCuenta(cuentas.get(c))
    m.set(c, arr)
  })
  // el redondeo se ajusta en la cuenta de mayor peso para que el rubro quede exacto
  const dif = r2(presObjetivo - acum)
  if (dif) {
    const c = ctas[mayor], arr = m.get(c)!
    arr[mes] = r2(arr[mes] + dif * signoCuenta(cuentas.get(c)))
  }
}

/** Reparte un total anual en 12 meses según la estacionalidad indicada (o en partes iguales). */
export function estacionalidad(total: number, base: number[]) {
  const b = base.map(Math.abs), sb = suma(b)
  let acum = 0
  return b.map((x, i) => {
    const v = i < 11 ? r2(sb ? total * x / sb : total / 12) : r2(total - acum)
    acum += v
    return v
  })
}
