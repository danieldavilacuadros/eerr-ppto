export const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic']
export const MESES_LARGOS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

const fmt0 = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 0 })
const fmtPct = new Intl.NumberFormat('es-PE', { style: 'percent', maximumFractionDigits: 1 })

/** Número en formato contable: negativos entre paréntesis, ceros como guion. */
export function num(v: number | null | undefined, enMiles = false): string {
  if (v == null || !isFinite(v)) return ''
  const x = enMiles ? v / 1000 : v
  if (Math.abs(x) < 0.5) return '–'
  const s = fmt0.format(Math.abs(x))
  return x < 0 ? `(${s})` : s
}

export function pct(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return ''
  return fmtPct.format(v)
}

/** Interpreta lo que escribe el usuario: "1,234.5", "1.234,5", "(500)", "-500", "12k". */
export function parseNumero(txt: string): number | null {
  let s = txt.trim()
  if (!s) return 0
  let neg = false
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1) }
  let mult = 1
  if (/[kK]$/.test(s)) { mult = 1000; s = s.slice(0, -1) }
  s = s.replace(/[S/$\s]/g, '')
  const coma = s.lastIndexOf(','), punto = s.lastIndexOf('.')
  if (coma > punto) s = s.replace(/\./g, '').replace(',', '.')
  else s = s.replace(/,/g, '')
  const n = Number(s)
  if (!isFinite(n)) return null
  return (neg ? -n : n) * mult
}

export const suma = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
export const ceros = () => new Array(12).fill(0) as number[]
