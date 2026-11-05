import * as XLSX from 'xlsx'
import { MESES } from './formato'

export interface FilaPlantilla {
  sede: string
  unidad: string
  linea: string
  cuenta: string
  nombre: string
  rubro: string
  valores: number[] // 12 meses, en positivo según la naturaleza de la cuenta
}

const CABECERA = ['Sede', 'Unidad', 'Linea', 'Cuenta', 'Nombre cuenta', 'Rubro', ...MESES, 'Total']

/** Descarga la plantilla de presupuesto con los valores actuales. */
export function exportarPlantilla(filas: FilaPlantilla[], archivo: string, titulo: string) {
  const aoa: (string | number | null)[][] = [
    [titulo],
    ['Ingrese importes en POSITIVO según la naturaleza de la cuenta (ingresos y gastos en positivo). No cambie las columnas Sede, Unidad, Linea ni Cuenta. Puede agregar filas con nuevas cuentas.'],
    CABECERA,
  ]
  for (const f of filas) {
    aoa.push([f.sede, f.unidad, f.linea, f.cuenta, f.nombre, f.rubro, ...f.valores.map(v => Math.round(v * 100) / 100), null])
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  // columna Total con fórmula para que el usuario vea la suma al editar
  filas.forEach((_, i) => {
    const r = i + 4
    ws[XLSX.utils.encode_cell({ r: r - 1, c: 18 })] = { t: 'n', f: `SUM(G${r}:R${r})` }
  })
  ws['!cols'] = [{ wch: 6 }, { wch: 9 }, { wch: 10 }, { wch: 10 }, { wch: 42 }, { wch: 34 }, ...MESES.map(() => ({ wch: 12 })), { wch: 14 }]
  ws['!freeze'] = { xSplit: 6, ySplit: 3 }
  ws['!autofilter'] = { ref: `A3:S${filas.length + 3}` }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'PPTO')
  XLSX.writeFile(wb, archivo)
}

export interface LecturaPlantilla {
  filas: FilaPlantilla[]
  errores: string[]
}

const norm = (s: unknown) => String(s ?? '').trim().toUpperCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Lee una plantilla de presupuesto (la que descarga la app, o cualquier hoja con las mismas columnas). */
export async function leerPlantilla(archivo: File): Promise<LecturaPlantilla> {
  const wb = XLSX.read(await archivo.arrayBuffer(), { type: 'array' })
  const ws = wb.Sheets['PPTO'] ?? wb.Sheets[wb.SheetNames[0]]
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null })
  const errores: string[] = []
  const iCab = aoa.findIndex(r => r.some(c => norm(c) === 'CUENTA') && r.some(c => norm(c) === 'SEDE'))
  if (iCab < 0) return { filas: [], errores: ['No se encontró la fila de cabecera (debe tener columnas Sede, Unidad, Linea, Cuenta, Ene…Dic).'] }
  const cab = aoa[iCab].map(norm)
  const col = (n: string) => cab.indexOf(n)
  const cSede = col('SEDE'), cUni = col('UNIDAD'), cLin = col('LINEA'), cCta = col('CUENTA')
  const cNom = col('NOMBRE CUENTA'), cRub = col('RUBRO')
  const cMes = MESES.map(m => col(norm(m)))
  if ([cSede, cUni, cLin, cCta].some(x => x < 0)) errores.push('Faltan columnas obligatorias: Sede, Unidad, Linea, Cuenta.')
  if (cMes.some(x => x < 0)) errores.push(`Faltan columnas de meses (${MESES.join(', ')}).`)
  if (errores.length) return { filas: [], errores }

  const filas: FilaPlantilla[] = []
  for (let i = iCab + 1; i < aoa.length; i++) {
    const r = aoa[i]
    if (!r || r.every(c => c == null || c === '')) continue
    const cuenta = String(r[cCta] ?? '').trim()
    if (!cuenta) continue
    const valores = cMes.map(c => {
      const v = r[c]
      if (v == null || v === '') return 0
      const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''))
      if (!isFinite(n)) { errores.push(`Fila ${i + 1}: valor no numérico "${v}"`); return 0 }
      return n
    })
    filas.push({
      sede: norm(r[cSede]), unidad: norm(r[cUni]), linea: norm(r[cLin]), cuenta,
      nombre: cNom >= 0 ? String(r[cNom] ?? '') : '', rubro: cRub >= 0 ? String(r[cRub] ?? '') : '', valores,
    })
  }
  return { filas, errores }
}

/** Lee una hoja genérica como lista de objetos usando la primera fila con datos como cabecera. */
export async function leerTabla(archivo: File): Promise<Record<string, unknown>[]> {
  const wb = XLSX.read(await archivo.arrayBuffer(), { type: 'array', cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const filas = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null, raw: true })
  return filas.map(f => Object.fromEntries(Object.entries(f).map(([k, v]) => [norm(k), v])))
}

export function exportarTabla(aoa: (string | number | null)[][], archivo: string, hoja = 'Reporte') {
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, hoja)
  XLSX.writeFile(wb, archivo)
}
