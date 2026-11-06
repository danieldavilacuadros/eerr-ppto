import { useCallback, useEffect, useState } from 'react'
import { useDatos } from '../lib/datos'
import { MESES_LARGOS, num } from '../lib/formato'
import { leerTabla } from '../lib/excel'
import { supabase } from '../lib/supabase'

// nombres de columna aceptados (se comparan en mayúsculas y sin tildes)
const ALIAS: Record<string, string[]> = {
  anio: ['ANIO', 'ANO', 'EJERCICIO'],
  mes: ['MES', 'PERIODO'],
  fecha: ['FECHA', 'FECHA CONTABLE', 'FECHA DE CONTABILIZACION'],
  sede: ['SEDE', 'SUCURSAL'],
  unidad: ['UNIDAD', 'UNIDAD NEGOCIO', 'UNIDAD DE NEGOCIO', 'UN'],
  linea: ['LINEA', 'MARCA'],
  cuenta: ['CUENTA', 'CUENTA MAYOR', 'CUENTA DE MAYOR', 'N CUENTA'],
  descripcion: ['DESCRIPCION', 'NOMBRE CUENTA', 'NOMBRE'],
  monto: ['MONTO', 'IMPORTE', 'IMPORTE S/.', 'IMPORTE S/', 'IMPORTE ML', 'SALDO', 'TOTAL'],
}

interface Fila { anio: number; mes: number; sede: string; unidad: string; linea: string; cuenta: string; monto: number; desc: string }

export default function CargaReal() {
  const { cat, recargar } = useDatos()
  const reales = cat?.escenarios.filter(e => e.tipo === 'real') ?? []
  const [escId, setEscId] = useState<number | undefined>(reales.at(-1)?.id)
  const esc = reales.find(e => e.id === escId)
  const [invertir, setInvertir] = useState(false)
  const [crearCuentas, setCrearCuentas] = useState(true)
  const [filas, setFilas] = useState<Fila[] | null>(null)
  const [errores, setErrores] = useState<string[]>([])
  const [estado, setEstado] = useState<string | null>(null)

  if (!cat) return null

  async function leer(f: File) {
    setEstado(null)
    const tabla = await leerTabla(f)
    if (!tabla.length) { setErrores(['El archivo está vacío.']); return }
    const cols = Object.keys(tabla[0])
    const col = (k: string) => cols.find(c => ALIAS[k].includes(c))
    const c = Object.fromEntries(Object.keys(ALIAS).map(k => [k, col(k)])) as Record<string, string | undefined>
    const err: string[] = []
    const faltan = ['sede', 'unidad', 'linea', 'cuenta', 'monto'].filter(k => !c[k])
    if (!c.mes && !c.fecha) faltan.push('mes o fecha')
    if (faltan.length) { setErrores([`Faltan columnas: ${faltan.join(', ')}. Columnas encontradas: ${cols.join(', ')}`]); setFilas(null); return }

    const sedes = new Set(cat!.sedes.map(s => s.codigo))
    const unidades = new Set(cat!.unidades.map(u => u.codigo))
    const salida: Fila[] = []
    tabla.forEach((r, i) => {
      let anio = c.anio ? Number(r[c.anio]) : esc?.anio ?? 0
      let mes = c.mes ? Number(String(r[c.mes]).replace(/\D/g, '').slice(-2)) : 0
      if (c.fecha && r[c.fecha] instanceof Date) { const d = r[c.fecha] as Date; anio = d.getFullYear(); mes = d.getMonth() + 1 }
      const sede = String(r[c.sede!] ?? '').trim().toUpperCase()
      const unidad = String(r[c.unidad!] ?? '').trim().toUpperCase()
      const linea = String(r[c.linea!] ?? '').trim().toUpperCase()
      const cuenta = String(r[c.cuenta!] ?? '').trim()
      const monto = Number(r[c.monto!] ?? 0) * (invertir ? -1 : 1)
      const fila = i + 2
      if (!cuenta && !monto) return
      if (!(mes >= 1 && mes <= 12)) return err.push(`Fila ${fila}: mes inválido`)
      if (esc && anio !== esc.anio) return err.push(`Fila ${fila}: año ${anio} distinto al escenario ${esc.anio}`)
      if (!sedes.has(sede)) return err.push(`Fila ${fila}: sede "${sede}" no existe (debe ser una sola sede)`)
      if (!unidades.has(unidad)) return err.push(`Fila ${fila}: unidad "${unidad}" no existe (debe ser una sola unidad)`)
      if (!linea || linea.includes(',')) return err.push(`Fila ${fila}: línea "${linea}" inválida (debe ser una sola línea)`)
      if (!/^\d{7}$/.test(cuenta)) return err.push(`Fila ${fila}: cuenta "${cuenta}" inválida`)
      if (!isFinite(monto)) return err.push(`Fila ${fila}: monto inválido`)
      salida.push({ anio, mes, sede, unidad, linea, cuenta, monto, desc: c.descripcion ? String(r[c.descripcion] ?? '') : '' })
    })
    setFilas(salida)
    setErrores(err)
  }

  const cuentasExist = new Set(cat.cuentas.map(c => c.cuenta))
  const nuevasCuentas = [...new Map((filas ?? []).filter(f => !cuentasExist.has(f.cuenta)).map(f => [f.cuenta, f.desc])).entries()]
  const lineasExist = new Set(cat.lineas.map(l => l.codigo))
  const nuevasLineas = [...new Set((filas ?? []).filter(f => !lineasExist.has(f.linea)).map(f => f.linea))]
  const periodos = [...new Set((filas ?? []).map(f => f.mes))].sort((a, b) => a - b)
  const ingresos = (filas ?? []).filter(f => f.cuenta.startsWith('7')).reduce((s, f) => s + f.monto, 0)
  const gastos = (filas ?? []).filter(f => f.cuenta.startsWith('6')).reduce((s, f) => s + f.monto, 0)

  async function cargar() {
    if (!esc || !filas?.length) return
    if (nuevasCuentas.length && !crearCuentas) { setEstado('Hay cuentas nuevas: active "crear cuentas nuevas" o agréguelas en Mapeo de cuentas.'); return }
    if (!confirm(`Se reemplazará el real de ${esc.nombre} para los meses ${periodos.join(', ')}. ¿Continuar?`)) return
    try {
      setEstado('Preparando catálogos…')
      if (nuevasLineas.length) {
        const { error } = await supabase.from('lineas').upsert(nuevasLineas.map(l => ({ codigo: l, nombre: l })), { onConflict: 'codigo' })
        if (error) throw error
      }
      if (nuevasCuentas.length) {
        const { error } = await supabase.from('cuentas').upsert(
          nuevasCuentas.map(([c, d]) => ({ cuenta: c, nombre: d || c, clase: c[0] })), { onConflict: 'cuenta' })
        if (error) throw error
      }
      const centros = [...new Set(filas.map(f => `${f.sede}|${f.unidad}|${f.linea}`))]
        .map(k => { const [sede, unidad, linea] = k.split('|'); return { sede, unidad, linea } })
      const { error: eC } = await supabase.from('centros').upsert(centros, { onConflict: 'sede,unidad,linea', ignoreDuplicates: true })
      if (eC) throw eC

      setEstado('Borrando meses anteriores…')
      const { error: eD } = await supabase.from('real_montos').delete().eq('escenario_id', esc.id).eq('anio', esc.anio).in('mes', periodos)
      if (eD) throw eD

      // consolidar por mes/centro/cuenta para no duplicar filas
      const agg = new Map<string, Fila>()
      for (const f of filas) {
        const k = `${f.mes}|${f.sede}|${f.unidad}|${f.linea}|${f.cuenta}`
        if (agg.has(k)) agg.get(k)!.monto += f.monto; else agg.set(k, { ...f })
      }
      const lote = crypto.randomUUID()
      const filasBD = [...agg.values()].map(f => ({
        escenario_id: esc.id, anio: f.anio, mes: f.mes, sede: f.sede, unidad: f.unidad, linea: f.linea,
        cuenta: f.cuenta, monto: Math.round(f.monto * 100) / 100, lote,
      }))
      for (let i = 0; i < filasBD.length; i += 500) {
        setEstado(`Guardando ${i} / ${filasBD.length}…`)
        const { error } = await supabase.from('real_montos').insert(filasBD.slice(i, i + 500))
        if (error) throw error
      }
      setEstado(`Carga completa: ${filasBD.length} registros en ${periodos.length} mes(es).`)
      setFilas(null)
      recargar()
    } catch (e) {
      setEstado(`Error: ${(e as { message?: string }).message}`)
    }
  }

  return (
    <div>
      <h1>Carga del real (SAP)</h1>
      <p className="sub">Suba el detalle contable del mes (base de datos SAP) con columnas: Año, Mes (o Fecha), Sede, Unidad de negocio, Línea, Cuenta, Importe.
        Los meses incluidos en el archivo reemplazan lo cargado antes.</p>
      <ActualizarSap />
      <div className="tarjeta">
        <div className="filtros">
          <label>Escenario real
            <select value={escId} onChange={e => setEscId(Number(e.target.value))}>
              {reales.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </select>
          </label>
          <label className="check"><input type="checkbox" checked={invertir} onChange={e => { setInvertir(e.target.checked); setFilas(null) }} />
            Invertir signo (si en SAP los ingresos vienen negativos)</label>
          <label className="check"><input type="checkbox" checked={crearCuentas} onChange={e => setCrearCuentas(e.target.checked)} />
            Crear cuentas nuevas automáticamente</label>
        </div>
        <input type="file" accept=".xlsx,.xls,.csv" onChange={e => e.target.files?.[0] && leer(e.target.files[0])} />

        {filas && (
          <div style={{ marginTop: 12 }}>
            <p><strong>{filas.length}</strong> filas válidas · meses {periodos.join(', ')} · ingresos (cuentas 7) <strong>{num(ingresos)}</strong> ·
              gastos (cuentas 6) <strong>{num(gastos)}</strong></p>
            {ingresos < 0 && <div className="alerta">Los ingresos suman negativo: probablemente deba marcar «Invertir signo».</div>}
            {nuevasCuentas.length > 0 && <div className="alerta">{nuevasCuentas.length} cuenta(s) nueva(s) que quedarán «sin clasificar» hasta mapearlas: {nuevasCuentas.slice(0, 15).map(c => c[0]).join(', ')}…</div>}
            {nuevasLineas.length > 0 && <div className="alerta">Líneas nuevas que se crearán: {nuevasLineas.join(', ')}</div>}
            <button className="primario" onClick={cargar} disabled={!filas.length}>Reemplazar real de esos meses</button>
          </div>
        )}
        {errores.length > 0 && (
          <div className="alerta error lista">
            <strong>{errores.length} fila(s) con observaciones (no se cargarán):</strong>
            {errores.slice(0, 40).map((e, i) => <div key={i}>{e}</div>)}
          </div>
        )}
        {estado && <div className={`alerta ${estado.startsWith('Error') ? 'error' : 'ok'}`}>{estado}</div>}
      </div>
    </div>
  )
}

// =============================================================================== actualización desde SAP
interface Pedido { id: number; anio: number; mes: number; estado: string; mensaje: string | null; pedido_en: string; atendido_en: string | null }

/** Botón que pide al script de la PC con acceso a SAP que traiga el real del último mes cerrado. */
function ActualizarSap() {
  const hoy = new Date()
  const ultimo = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1) // último mes cerrado
  const anio = ultimo.getFullYear(), mes = ultimo.getMonth() + 1
  const [pedidos, setPedidos] = useState<Pedido[] | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.from('sap_pedidos').select('*').order('pedido_en', { ascending: false }).limit(5)
    if (error) { setMsg(error.message); setPedidos([]); return }
    setPedidos((data ?? []) as Pedido[])
  }, [])
  useEffect(() => { cargar() }, [cargar])

  const pendiente = pedidos?.find(p => p.estado === 'pendiente' || p.estado === 'procesando')
  // un pedido por día (los que terminaron en error no cuentan, para poder reintentar)
  const deHoy = pedidos?.find(p => p.estado !== 'error' && new Date(p.pedido_en).toDateString() === hoy.toDateString())

  async function pedir() {
    setMsg(null)
    const { data: hoyBD } = await supabase.from('sap_pedidos').select('id')
      .neq('estado', 'error').gte('pedido_en', new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).toISOString()).limit(1)
    if (hoyBD && hoyBD.length) { setMsg('Ya hay un pedido de hoy. Se permite una actualización desde SAP por día.'); cargar(); return }
    const { error } = await supabase.from('sap_pedidos').insert({ anio, mes })
    if (error) { setMsg(error.message); return }
    setMsg(`Pedido registrado: ${MESES_LARGOS[mes - 1]} ${anio}. Se atenderá la próxima vez que se inicie la PC con acceso a SAP (VPN) y reemplazará el real de ese mes.`)
    cargar()
  }

  return (
    <div className="tarjeta">
      <div className="barra">
        <strong>Actualizar desde SAP</strong>
        <span className="ayuda">Sólo trae el último mes cerrado ({MESES_LARGOS[mes - 1]} {anio}), una vez al día, para no saturar SAP. Se atiende al iniciar la PC con acceso a SAP. Para varios meses use el script de la PC.</span>
        <div className="espacio" />
        <button className="primario" onClick={pedir} disabled={!!pendiente || !!deHoy}>
          {pendiente ? 'Pedido en curso…' : deHoy ? 'Ya se actualizó hoy' : `Actualizar ${MESES_LARGOS[mes - 1].toLowerCase()} desde SAP`}
        </button>
        <button onClick={cargar}>Refrescar</button>
      </div>
      {msg && <div className="alerta">{msg}</div>}
      {pedidos && pedidos.length > 0 && (
        <table className="tabla">
          <thead><tr><th>Período</th><th>Estado</th><th>Pedido</th><th>Atendido</th><th>Detalle</th></tr></thead>
          <tbody>
            {pedidos.map(p => (
              <tr key={p.id}>
                <td>{MESES_LARGOS[p.mes - 1]} {p.anio}</td>
                <td><span className={`chip ${p.estado === 'ok' ? 'ok' : p.estado === 'error' ? 'error' : 'azul'}`}>{p.estado}</span></td>
                <td>{new Date(p.pedido_en).toLocaleString('es-PE')}</td>
                <td>{p.atendido_en ? new Date(p.atendido_en).toLocaleString('es-PE') : '—'}</td>
                <td>{p.mensaje ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
