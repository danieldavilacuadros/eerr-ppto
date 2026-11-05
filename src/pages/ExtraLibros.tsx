import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Celda } from '../components/Celda'
import { esRol, useDatos } from '../lib/datos'
import { MESES, ceros, num, parseNumero, suma } from '../lib/formato'
import { supabase, traerTodo, upsertEnLotes } from '../lib/supabase'
import { exportarExtraLibros, leerExtraLibros, type FilaExtra } from '../lib/excel'

/** Fila de la grilla: un centro (sede · unidad · línea) y una cuenta, con 12 meses. */
interface Fila { sede: string; unidad: string; linea: string; cuenta: string }
type Valores = Map<string, number[]>
interface Registro extends Fila { mes: number; monto: number }

const clave = (f: Fila) => `${f.sede}|${f.unidad}|${f.linea}|${f.cuenta}`
const deClave = (k: string): Fila => { const [sede, unidad, linea, cuenta] = k.split('|'); return { sede, unidad, linea, cuenta } }
const norm = (s: string) => s.trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

// Nombres comerciales que usa contabilidad en su Excel → código de línea de SAP
const ALIAS_LINEA: Record<string, string> = {
  'CV': 'HCV', 'HYUNDAI CV': 'HCV', 'PV & LCV': 'HPV', 'PV': 'HPV', 'HYUNDAI PV': 'HPV',
  'MOTORMUNDO': 'MOT', 'MOTOR MUNDO': 'MOT', 'FORD': 'FOR', 'DIVEMOTOR': 'DIVEMOTO', 'DONGFENG': 'DONG', 'DONG FENG': 'DONG',
  'MITSUBISHI': 'MITSUBIS', 'CASTROL': 'CAS', 'MOBIL': 'MOB', 'SEMINUEVOS': 'UNI-SEMI', 'PREMIUM': 'VOLVO', 'PREMIUN': 'VOLVO',
}

export default function ExtraLibros() {
  const { perfil, cat } = useDatos()
  const editable = esRol(perfil, 'admin', 'contabilidad')
  const escs = useMemo(() => (cat?.escenarios ?? []).filter(e => e.tipo === 'real'), [cat])
  const [escId, setEscId] = useState<number | undefined>(() => {
    const anio = new Date().getFullYear()
    return (escs.find(e => e.anio === anio) ?? escs.at(-1))?.id
  })
  const esc = escs.find(e => e.id === escId)

  const [valores, setValores] = useState<Valores | null>(null)
  const [originales, setOriginales] = useState<Valores>(new Map())
  const [fSede, setFSede] = useState('')
  const [fUnidad, setFUnidad] = useState('')
  const [buscar, setBuscar] = useState('')
  const [nueva, setNueva] = useState<Fila>({ sede: '', unidad: '', linea: '', cuenta: '' })
  const [guardando, setGuardando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: string; texto: string } | null>(null)
  const [errores, setErrores] = useState<string[]>([])

  const cargar = useCallback(async () => {
    if (!esc) return
    setValores(null)
    setMsg(null)
    try {
      const regs = await traerTodo<Registro>((d, h) => supabase.from('extra_libros')
        .select('sede, unidad, linea, cuenta, mes, monto').eq('escenario_id', esc.id).eq('anio', esc.anio).range(d, h))
      const m: Valores = new Map()
      for (const r of regs) {
        const k = clave(r)
        const arr = m.get(k) ?? ceros()
        arr[r.mes - 1] += Number(r.monto)
        m.set(k, arr)
      }
      setOriginales(new Map([...m].map(([k, v]) => [k, [...v]])))
      setValores(m)
    } catch (e) {
      setMsg({ tipo: 'error', texto: (e as Error).message })
      setValores(new Map())
    }
  }, [esc])
  useEffect(() => { cargar() }, [cargar])

  const nombreCuenta = useMemo(() => new Map((cat?.cuentas ?? []).map(c => [c.cuenta, c.nombre])), [cat])
  const lineasValidas = useMemo(() => new Set((cat?.lineas ?? []).map(l => l.codigo)), [cat])
  const lineaPorNombre = useMemo(() => new Map((cat?.lineas ?? []).map(l => [norm(l.nombre), l.codigo])), [cat])
  const resolverLinea = (txt: string) => {
    const t = norm(txt)
    if (lineasValidas.has(t)) return t
    return ALIAS_LINEA[t] ?? lineaPorNombre.get(t) ?? t
  }

  // filas visibles (orden: sede, unidad, línea, cuenta)
  const filas = useMemo(() => {
    if (!valores) return []
    const q = norm(buscar)
    return [...valores.keys()].map(deClave)
      .filter(f => (!fSede || f.sede === fSede) && (!fUnidad || f.unidad === fUnidad))
      .filter(f => !q || norm(`${f.linea} ${f.cuenta} ${nombreCuenta.get(f.cuenta) ?? ''}`).includes(q))
      .sort((a, b) => clave(a).localeCompare(clave(b)))
  }, [valores, fSede, fUnidad, buscar, nombreCuenta])
  const filasRef = useRef(filas)
  filasRef.current = filas

  // cambios pendientes (celda a celda)
  const cambios = useMemo(() => {
    const out: (Fila & { mes: number; monto: number })[] = []
    if (!valores) return out
    const claves = new Set([...valores.keys(), ...originales.keys()])
    for (const k of claves) {
      const v = valores.get(k) ?? ceros(), o = originales.get(k) ?? ceros()
      for (let i = 0; i < 12; i++) if (Math.abs((v[i] ?? 0) - (o[i] ?? 0)) > 0.004) out.push({ ...deClave(k), mes: i + 1, monto: Math.round(v[i] * 100) / 100 })
    }
    return out
  }, [valores, originales])

  const fijar = useCallback((fila: number, col: number, n: number) => {
    const f = filasRef.current[fila]
    if (!f || col > 11) return
    setValores(prev => {
      const m = new Map(prev!)
      const arr = [...(m.get(clave(f)) ?? ceros())]
      arr[col] = n
      m.set(clave(f), arr)
      return m
    })
  }, [])

  const pegar = useCallback((fila: number, col: number, texto: string) => {
    const lineas = texto.replace(/\r/g, '').split('\n').filter((l, i, a) => l !== '' || i < a.length - 1)
    setValores(prev => {
      const m = new Map(prev!)
      lineas.forEach((linea, i) => {
        const f = filasRef.current[fila + i]
        if (!f) return
        const arr = [...(m.get(clave(f)) ?? ceros())]
        linea.split('\t').forEach((t, j) => {
          const c = col + j
          if (c > 11) return
          const n = parseNumero(t)
          if (n != null) arr[c] = n
        })
        m.set(clave(f), arr)
      })
      return m
    })
  }, [])

  function agregarFila() {
    const f = { ...nueva, linea: resolverLinea(nueva.linea), cuenta: nueva.cuenta.trim().split(' ')[0] }
    const err = validar([f])
    if (err.length) { setErrores(err); return }
    setErrores([])
    setValores(prev => {
      const m = new Map(prev!)
      if (!m.has(clave(f))) m.set(clave(f), ceros())
      return m
    })
    setNueva(n => ({ ...n, cuenta: '' }))
  }

  function quitarFila(f: Fila) {
    setValores(prev => { const m = new Map(prev!); m.set(clave(f), ceros()); return m })
  }

  function validar(fs: Fila[]) {
    const err: string[] = []
    const sedes = new Set(cat!.sedes.map(s => s.codigo)), unis = new Set(cat!.unidades.map(u => u.codigo))
    for (const f of fs) {
      const donde = `${f.sede || '?'} · ${f.unidad || '?'} · ${f.linea || '?'} · ${f.cuenta || '?'}`
      if (!sedes.has(f.sede)) err.push(`${donde}: sede "${f.sede}" no existe`)
      if (!unis.has(f.unidad)) err.push(`${donde}: unidad "${f.unidad}" no existe`)
      if (!lineasValidas.has(f.linea)) err.push(`${donde}: línea "${f.linea}" no existe (créela en Mapeo de cuentas o use el código SAP)`)
      if (!nombreCuenta.has(f.cuenta)) err.push(`${donde}: cuenta "${f.cuenta}" no existe en el plan de cuentas`)
    }
    return [...new Set(err)]
  }

  async function guardar() {
    if (!esc || !cambios.length) return
    const err = validar(cambios)
    if (err.length) { setErrores(err); return }
    setGuardando(true)
    setMsg(null)
    setErrores([])
    try {
      const subir = cambios.filter(c => Math.abs(c.monto) >= 0.005)
        .map(c => ({ escenario_id: esc.id, anio: esc.anio, ...c }))
      await upsertEnLotes('extra_libros', subir, { onConflict: 'escenario_id,anio,mes,sede,unidad,linea,cuenta' })
      for (const c of cambios.filter(c => Math.abs(c.monto) < 0.005)) {
        const { error } = await supabase.from('extra_libros').delete()
          .match({ escenario_id: esc.id, anio: esc.anio, mes: c.mes, sede: c.sede, unidad: c.unidad, linea: c.linea, cuenta: c.cuenta })
        if (error) throw new Error(error.message)
      }
      setMsg({ tipo: 'ok', texto: `Guardado: ${cambios.length} celda(s).` })
      await cargar()
    } catch (e) {
      setMsg({ tipo: 'error', texto: (e as Error).message })
    } finally {
      setGuardando(false)
    }
  }

  function descargar() {
    if (!esc || !valores) return
    const fs: FilaExtra[] = filas.map(f => ({ ...f, descripcion: nombreCuenta.get(f.cuenta) ?? '', valores: valores.get(clave(f)) ?? ceros() }))
    exportarExtraLibros(fs, `Extra_libros_${esc.codigo}.xlsx`, `${esc.nombre} · ${perfil?.nombre ?? ''}`)
  }

  async function subirArchivo(archivo: File) {
    setMsg(null)
    const { filas: fs, errores: errLectura } = await leerExtraLibros(archivo)
    const conLinea = fs.map(f => ({ ...f, linea: resolverLinea(f.linea) }))
    const err = [...errLectura, ...validar(conLinea)]
    if (err.length) { setErrores(err); return }
    setErrores([])
    // el archivo reemplaza los meses que trae para cada fila (las demás filas no se tocan)
    setValores(prev => {
      const m = new Map(prev!)
      const acumulado = new Map<string, number[]>()
      for (const f of conLinea) {
        const k = clave(f)
        const arr = acumulado.get(k) ?? ceros()
        f.valores.forEach((v, i) => { arr[i] += v })
        acumulado.set(k, arr)
      }
      for (const [k, v] of acumulado) m.set(k, v)
      return m
    })
    setMsg({ tipo: 'ok', texto: `Archivo leído: ${conLinea.length} fila(s). Revise y pulse Guardar para registrarlas.` })
  }

  if (!cat) return null
  if (!escs.length) return <div className="tarjeta">No hay escenarios de real.</div>

  const totalMes = MESES.map((_, i) => filas.reduce((t, f) => t + (valores?.get(clave(f))?.[i] ?? 0), 0))
  const unidadesConDatos = new Set([...(valores?.keys() ?? [])].map(k => deClave(k).unidad))

  return (
    <div>
      <div className="encabezado">
        <div>
          <h1>Registro extra libros</h1>
          <p className="sub">Montos que contabilidad agrega al real fuera de SAP · se suman al real en los estados de resultados</p>
        </div>
        <label>Escenario
          <select value={escId} onChange={e => setEscId(Number(e.target.value))}>
            {escs.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </label>
      </div>

      <div className="tarjeta">
        <div className="barra herramientas">
          <select value={fSede} onChange={e => setFSede(e.target.value)}>
            <option value="">Todas las sedes</option>
            {cat.sedes.map(s => <option key={s.codigo} value={s.codigo}>{s.nombre}</option>)}
          </select>
          <select value={fUnidad} onChange={e => setFUnidad(e.target.value)}>
            <option value="">Todas las unidades</option>
            {cat.unidades.filter(u => !valores || unidadesConDatos.has(u.codigo) || !valores.size)
              .map(u => <option key={u.codigo} value={u.codigo}>{u.nombre}</option>)}
          </select>
          <input className="buscar" placeholder="Buscar línea o cuenta…" value={buscar} onChange={e => setBuscar(e.target.value)} />
          <div className="espacio" />
          <button onClick={descargar} disabled={!valores}>Descargar Excel</button>
          {editable && (
            <label className="boton-archivo">Cargar Excel
              <input type="file" accept=".xlsx,.xls" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) subirArchivo(f) }} />
            </label>
          )}
          {editable && (
            <button className="primario" disabled={!cambios.length || guardando} onClick={guardar}>
              {guardando ? 'Guardando…' : cambios.length ? `Guardar (${cambios.length})` : 'Guardado'}
            </button>
          )}
        </div>

        {editable && (
          <div className="barra">
            <select value={nueva.sede} onChange={e => setNueva(n => ({ ...n, sede: e.target.value }))}>
              <option value="">Sede…</option>
              {cat.sedes.map(s => <option key={s.codigo} value={s.codigo}>{s.codigo}</option>)}
            </select>
            <select value={nueva.unidad} onChange={e => setNueva(n => ({ ...n, unidad: e.target.value }))}>
              <option value="">Unidad…</option>
              {cat.unidades.map(u => <option key={u.codigo} value={u.codigo}>{u.codigo} · {u.nombre}</option>)}
            </select>
            <select value={nueva.linea} onChange={e => setNueva(n => ({ ...n, linea: e.target.value }))}>
              <option value="">Línea…</option>
              {cat.lineas.map(l => <option key={l.codigo} value={l.codigo}>{l.codigo} · {l.nombre}</option>)}
            </select>
            <input list="extra-cuentas" className="buscar" placeholder="Cuenta…" value={nueva.cuenta}
              onChange={e => setNueva(n => ({ ...n, cuenta: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') agregarFila() }} />
            <datalist id="extra-cuentas">
              {cat.cuentas.filter(c => /^[67]/.test(c.cuenta)).map(c => <option key={c.cuenta} value={c.cuenta}>{c.nombre}</option>)}
            </datalist>
            <button onClick={agregarFila} disabled={!nueva.sede || !nueva.unidad || !nueva.linea || !nueva.cuenta}>Agregar fila</button>
          </div>
        )}

        {msg && <div className={`alerta ${msg.tipo}`}>{msg.texto}</div>}
        {errores.length > 0 && (
          <div className="alerta error lista">
            <strong>No se puede registrar:</strong>
            <ul>{errores.slice(0, 50).map(e => <li key={e}>{e}</li>)}</ul>
            {errores.length > 50 && <div>… y {errores.length - 50} más</div>}
          </div>
        )}
        <p className="ayuda">
          Importes con <strong>signo de resultado</strong>: ingresos en positivo, costos y gastos en negativo (como en SAP).
          Puede pegar bloques copiados de Excel en los meses, o cargar el archivo con el formato del modelo extra libros
          (Sede, Unidad de negocio, Linea, Cuenta, Descripcion, Enero … Diciembre).
          {!editable && ' Sólo contabilidad puede modificar este registro.'}
        </p>

        {!valores ? <div>Cargando…</div> : (
          <div className="scroll grilla-cont">
            <table className="tabla grilla extra">
              <thead>
                <tr>
                  <th className="fija">Sede · Unidad · Línea · Cuenta</th>
                  {MESES.map(m => <th key={m} className="n">{m}</th>)}
                  <th className="n">Total</th>
                  {editable && <th />}
                </tr>
              </thead>
              <tbody>
                {filas.length === 0 && (
                  <tr><td className="fija" colSpan={editable ? 15 : 14}>Sin registros{fSede || fUnidad || buscar ? ' con este filtro' : ''}.</td></tr>
                )}
                {filas.map((f, fila) => {
                  const v = valores.get(clave(f)) ?? ceros()
                  const cambiada = cambios.some(c => clave(c) === clave(f))
                  return (
                    <tr key={clave(f)} className={`fila-cuenta${cambiada ? ' sucia' : ''}`}>
                      <td className="fija" title={nombreCuenta.get(f.cuenta)}>
                        <span className="cod">{f.sede} · {f.unidad} · {f.linea}</span> <span className="cod">{f.cuenta}</span> {nombreCuenta.get(f.cuenta)}
                      </td>
                      {v.map((x, i) => <td key={i}><Celda valor={x} editable={editable} fila={fila} col={i} onFijar={fijar} onPegar={pegar} /></td>)}
                      <td className="n b">{num(suma(v))}</td>
                      {editable && <td><button className="link" title="Poner la fila en cero" onClick={() => quitarFila(f)}>✕</button></td>}
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td className="fija">Total ({filas.length} filas)</td>
                  {totalMes.map((x, i) => <td key={i} className="n">{num(x)}</td>)}
                  <td className="n">{num(suma(totalMes))}</td>
                  {editable && <td />}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
