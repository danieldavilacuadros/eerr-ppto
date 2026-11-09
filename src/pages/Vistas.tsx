import { useEffect, useMemo, useState } from 'react'
import { cuentasDeVista, nombreDe, traerVistaCuentas, useDatos, type UnidadCuenta, type VistaCuenta } from '../lib/datos'
import { crearRubroDe } from '../lib/esquema'
import { supabase } from '../lib/supabase'
import type { Centro } from '../lib/tipos'

type Modo = 'lista' | 'vistas' | 'matriz'
type Sel = { sede: string; unidad: string; linea: string }
const clave = (c: Sel) => `${c.sede}|${c.unidad}|${c.linea}`

/**
 * Vistas de presupuesto (centros sede · unidad · marca) y las cuentas que se presupuestan en cada una.
 * Cada unidad de negocio tiene una lista de cuentas; una vista puede agregar o quitar cuentas de esa lista.
 */
export default function Vistas() {
  const { cat, recargar } = useDatos()
  const [modo, setModo] = useState<Modo>('lista')
  const [unidad, setUnidad] = useState('UNI')
  const [sede, setSede] = useState('')
  const [linea, setLinea] = useState('')
  const [buscar, setBuscar] = useState('')
  const [soloIncluidas, setSoloIncluidas] = useState(true)
  const [soloActivas, setSoloActivas] = useState(true)
  const [vistaSel, setVistaSel] = useState<Sel | null>(null)
  const [nueva, setNueva] = useState({ sede: '', linea: '' })
  const [msg, setMsg] = useState<{ tipo: string; texto: string } | null>(null)
  // copias locales para que los cambios se vean al instante; el catálogo se recarga en segundo plano
  const [uc, setUc] = useState<UnidadCuenta[]>([])
  const [vc, setVc] = useState<VistaCuenta[]>([])
  const [cen, setCen] = useState<Centro[]>([])
  const [cargandoExc, setCargandoExc] = useState(true)
  useEffect(() => { if (cat) { setUc(cat.unidadCuentas); setCen(cat.centros) } }, [cat])
  // las excepciones son muchas: se traen sólo las de la unidad elegida
  useEffect(() => {
    let vivo = true
    setCargandoExc(true)
    traerVistaCuentas({ unidad }).then(x => { if (vivo) { setVc(x); setCargandoExc(false) } })
    return () => { vivo = false }
  }, [unidad])

  const cuentasMap = useMemo(() => new Map((cat?.cuentas ?? []).map(c => [c.cuenta, c])), [cat])
  const rubroDe = useMemo(() => crearRubroDe(cuentasMap, cat?.excepciones ?? []), [cuentasMap, cat])
  const ordenRubro = useMemo(() => new Map((cat?.rubros ?? []).map(r => [r.codigo, r.orden])), [cat])

  // cuentas del mapa (activas, no estadísticas) ordenadas por rubro, con el rubro que les toca en la unidad
  const todas = useMemo(() => (cat?.cuentas ?? []).filter(c => c.activa && !c.es_estadistica)
    .map(c => ({ ...c, rubroU: rubroDe(c.cuenta, unidad) ?? 'SIN RUBRO' }))
    .sort((a, b) => (ordenRubro.get(a.rubroU) ?? 9999) - (ordenRubro.get(b.rubroU) ?? 9999) || a.cuenta.localeCompare(b.cuenta)),
  [cat, rubroDe, unidad, ordenRubro])
  const filtroTexto = (c: { cuenta: string; nombre: string; rubroU: string }) => {
    const t = buscar.trim().toLowerCase()
    return !t || c.cuenta.includes(t) || c.nombre.toLowerCase().includes(t) || c.rubroU.toLowerCase().includes(t)
  }

  const listaU = useMemo(() => new Set(uc.filter(x => x.unidad === unidad).map(x => x.cuenta)), [uc, unidad])
  const vistasU = useMemo(() => cen.filter(c => c.unidad === unidad && (!sede || c.sede === sede) && (!linea || c.linea === linea)
    && (!soloActivas || c.activo))
    .sort((a, b) => (cat?.sedes.findIndex(s => s.codigo === a.sede) ?? 0) - (cat?.sedes.findIndex(s => s.codigo === b.sede) ?? 0)
      || nombreDe(cat?.lineas, a.linea).localeCompare(nombreDe(cat?.lineas, b.linea))), [cen, unidad, sede, linea, soloActivas, cat])
  const excDe = useMemo(() => {
    const m = new Map<string, Map<string, boolean>>()
    for (const x of vc) { const k = clave(x); if (!m.has(k)) m.set(k, new Map()); m.get(k)!.set(x.cuenta, x.incluir) }
    return m
  }, [vc])
  const conteoExc = useMemo(() => {
    const m = new Map<string, { agrega: number; quita: number }>()
    for (const x of vc) {
      if (x.unidad !== unidad) continue
      const n = m.get(x.cuenta) ?? { agrega: 0, quita: 0 }
      if (x.incluir) n.agrega++; else n.quita++
      m.set(x.cuenta, n)
    }
    return m
  }, [vc, unidad])
  const lineasUnidad = useMemo(() => [...new Set(cen.filter(c => c.unidad === unidad).map(c => c.linea))]
    .sort((a, b) => nombreDe(cat?.lineas, a).localeCompare(nombreDe(cat?.lineas, b))), [cen, unidad, cat])

  if (!cat) return null
  const nomSede = (s: string) => nombreDe(cat.sedes, s)
  const nomLinea = (l: string) => nombreDe(cat.lineas, l)
  const nomUnidad = nombreDe(cat.unidades, unidad)
  const nomVista = (c: Sel) => `${nomSede(c.sede)} · ${nombreDe(cat.unidades, c.unidad)} · ${nomLinea(c.linea)}`
  const falla = (e: { message: string }) => { setMsg({ tipo: 'error', texto: e.message }); recargar() }
  const sinTablas = !cat.unidadCuentas.length

  // ------------------------------------------------------------------ cambios
  async function cambiarLista(cuenta: string, incluir: boolean) {
    setMsg(null)
    setUc(prev => incluir ? [...prev, { unidad, cuenta }] : prev.filter(x => !(x.unidad === unidad && x.cuenta === cuenta)))
    const { error } = incluir
      ? await supabase.from('unidad_cuentas').upsert({ unidad, cuenta }, { ignoreDuplicates: true })
      : await supabase.from('unidad_cuentas').delete().eq('unidad', unidad).eq('cuenta', cuenta)
    if (error) falla(error); else recargar()
  }
  /** Incluye o excluye una cuenta en una vista: si coincide con la lista de la unidad se borra la excepción. */
  async function cambiarVista(c: Sel, cuenta: string, incluir: boolean) {
    setMsg(null)
    const enLista = listaU.has(cuenta)
    const igual = (x: VistaCuenta) => x.sede === c.sede && x.unidad === c.unidad && x.linea === c.linea && x.cuenta === cuenta
    let error
    if (incluir === enLista) {
      setVc(prev => prev.filter(x => !igual(x)))
      ;({ error } = await supabase.from('vista_cuentas').delete()
        .eq('sede', c.sede).eq('unidad', c.unidad).eq('linea', c.linea).eq('cuenta', cuenta))
    } else {
      setVc(prev => [...prev.filter(x => !igual(x)), { ...c, cuenta, incluir }])
      ;({ error } = await supabase.from('vista_cuentas').upsert({ sede: c.sede, unidad: c.unidad, linea: c.linea, cuenta, incluir }))
    }
    if (error) falla(error); else recargar()
  }
  async function cambiarActiva(c: Centro, activo: boolean) {
    setMsg(null)
    setCen(prev => prev.map(x => clave(x) === clave(c) ? { ...x, activo } : x))
    const { error } = await supabase.from('centros').update({ activo }).eq('sede', c.sede).eq('unidad', c.unidad).eq('linea', c.linea)
    if (error) falla(error); else recargar()
  }
  async function crearVista() {
    if (!nueva.sede || !nueva.linea) return
    const c = { sede: nueva.sede, unidad, linea: nueva.linea }
    if (cen.some(x => clave(x) === clave(c))) { setMsg({ tipo: 'error', texto: `La vista ${nomVista(c)} ya existe.` }); return }
    const { error } = await supabase.from('centros').insert({ ...c, activo: true })
    if (error) { falla(error); return }
    setCen(prev => [...prev, { ...c, activo: true }]); setNueva({ sede: '', linea: '' })
    setMsg({ tipo: 'ok', texto: `Vista creada: ${nomVista(c)}. Usa la lista de ${nomUnidad}.` }); recargar()
  }

  const efectivas = (c: Sel) => cuentasDeVista(uc, vc, c)
  const estado = (c: Sel, cuenta: string): 'lista' | 'agregada' | 'quitada' | 'no' => {
    const e = excDe.get(clave(c))?.get(cuenta)
    if (e === true) return 'agregada'
    if (e === false) return 'quitada'
    // todas las vistas de esta pantalla son de la unidad elegida
    return listaU.has(cuenta) ? 'lista' : 'no'
  }

  // ------------------------------------------------------------------ pantalla
  return (
    <div>
      <h1>Vistas de presupuesto</h1>
      <p className="sub">Cada vista es una sede · unidad de negocio · marca (ej. Arequipa · Venta de unidades · Ford). Cada unidad de negocio
        tiene una <strong>lista de cuentas</strong> que se presupuestan en todas sus vistas; si hace falta, una vista puede agregar o quitar
        cuentas de esa lista. La carga de presupuesto sólo muestra las vistas activas y, en cada rubro, las cuentas de la vista.</p>
      {sinTablas && <div className="alerta">Falta ejecutar la migración <code>008_cuentas_por_vista.sql</code> en Supabase: mientras tanto
        el presupuesto muestra todas las cuentas del mapa en cada vista.</div>}
      {msg && <div className={`alerta ${msg.tipo}`}>{msg.texto}</div>}
      {cargandoExc && <div className="alerta">Cargando las excepciones de las vistas de {nombreDe(cat.unidades, unidad)}…</div>}

      <div className="tarjeta">
        <div className="filtros">
          <label>Unidad de negocio
            <select value={unidad} onChange={e => { setUnidad(e.target.value); setLinea(''); setVistaSel(null) }}>
              {cat.unidades.map(u => <option key={u.codigo} value={u.codigo}>{u.nombre}</option>)}
            </select>
          </label>
          {modo !== 'lista' && <>
            <label>Sede
              <select value={sede} onChange={e => setSede(e.target.value)}>
                <option value="">Todas</option>{cat.sedes.map(s => <option key={s.codigo} value={s.codigo}>{s.nombre}</option>)}
              </select>
            </label>
            <label>Marca
              <select value={linea} onChange={e => setLinea(e.target.value)}>
                <option value="">Todas</option>{lineasUnidad.map(l => <option key={l} value={l}>{nomLinea(l)}</option>)}
              </select>
            </label>
            <label className="check"><input type="checkbox" checked={soloActivas} onChange={e => setSoloActivas(e.target.checked)} />
              Sólo vistas activas</label>
          </>}
          <label>Buscar cuenta
            <input value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="Cuenta, nombre o rubro" />
          </label>
          <label className="check"><input type="checkbox" checked={soloIncluidas} onChange={e => setSoloIncluidas(e.target.checked)} />
            Sólo cuentas incluidas</label>
          <div className="espacio" />
          <div className="segmentado">
            <button className={modo === 'lista' ? 'activo' : ''} onClick={() => setModo('lista')}>Lista de la unidad</button>
            <button className={modo === 'vistas' ? 'activo' : ''} onClick={() => setModo('vistas')}>Vistas</button>
            <button className={modo === 'matriz' ? 'activo' : ''} onClick={() => setModo('matriz')}>Cuentas × vistas</button>
          </div>
        </div>
      </div>

      {modo === 'lista' && (
        <div className="tarjeta">
          <h3>Lista de {nomUnidad}: {listaU.size} cuentas</h3>
          <p className="sub">Marque las cuentas que se presupuestan en todas las vistas de {nomUnidad}. La lista inicial son las cuentas con
            movimiento en SAP en el Real 2026.</p>
          <div className="scroll" style={{ maxHeight: '65vh' }}>
            <table className="tabla simple">
              <thead><tr><th>Rubro</th><th>Cuenta</th><th>Nombre</th><th>En la lista</th><th className="n">Vistas que la agregan</th>
                <th className="n">Vistas que la quitan</th></tr></thead>
              <tbody>
                {todas.filter(c => (!soloIncluidas || listaU.has(c.cuenta)) && filtroTexto(c)).map(c => {
                  const n = conteoExc.get(c.cuenta)
                  return (
                    <tr key={c.cuenta}>
                      <td>{c.rubroU}</td><td className="cod">{c.cuenta}</td><td>{c.nombre}</td>
                      <td><input type="checkbox" checked={listaU.has(c.cuenta)} onChange={e => cambiarLista(c.cuenta, e.target.checked)} /></td>
                      <td className="n">{n?.agrega || ''}</td>
                      <td className="n">{n?.quita || ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modo === 'vistas' && (
        <div className={vistaSel ? 'columnas-iguales' : ''}>
          <div className="tarjeta">
            <h3>Vistas de {nomUnidad} ({vistasU.length})</h3>
            <div className="scroll" style={{ maxHeight: '65vh' }}>
              <table className="tabla simple ajustada">
                <thead><tr><th>Sede</th><th>Marca</th><th>Activa</th><th className="n">Cuentas</th><th className="n">Agregadas</th>
                  <th className="n">Quitadas</th><th /></tr></thead>
                <tbody>
                  {vistasU.map(c => {
                    const ef = efectivas(c)
                    const exc = [...(excDe.get(clave(c))?.values() ?? [])]
                    return (
                      <tr key={clave(c)} className={vistaSel && clave(vistaSel) === clave(c) ? 'seleccionada' : ''}>
                        <td>{nomSede(c.sede)}</td><td>{nomLinea(c.linea)}</td>
                        <td><input type="checkbox" checked={c.activo} onChange={e => cambiarActiva(c, e.target.checked)} /></td>
                        <td className="n">{ef ? ef.size : 'todas'}</td>
                        <td className="n">{exc.filter(Boolean).length || ''}</td>
                        <td className="n">{exc.filter(x => !x).length || ''}</td>
                        <td><button className="link" onClick={() => setVistaSel(c)}>Ver cuentas</button></td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td><select value={nueva.sede} onChange={e => setNueva({ ...nueva, sede: e.target.value })}>
                      <option value="">Sede…</option>{cat.sedes.map(s => <option key={s.codigo} value={s.codigo}>{s.nombre}</option>)}</select></td>
                    <td colSpan={3}><select value={nueva.linea} onChange={e => setNueva({ ...nueva, linea: e.target.value })}>
                      <option value="">Marca…</option>{[...cat.lineas].sort((a, b) => a.nombre.localeCompare(b.nombre))
                        .map(l => <option key={l.codigo} value={l.codigo}>{l.nombre}</option>)}</select></td>
                    <td colSpan={3}><button onClick={crearVista} disabled={!nueva.sede || !nueva.linea}>Crear vista</button></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {vistaSel && (
            <div className="tarjeta">
              <div className="barra">
                <h3 style={{ margin: 0 }}>Cuentas de {nomVista(vistaSel)}</h3>
                <div className="espacio" />
                <button className="link" onClick={() => setVistaSel(null)}>Cerrar</button>
              </div>
              <p className="sub">Desmarque para quitar una cuenta sólo en esta vista, o marque una que no está en la lista de la unidad para
                agregarla sólo aquí.</p>
              <div className="scroll" style={{ maxHeight: '60vh' }}>
                <table className="tabla simple">
                  <thead><tr><th>Rubro</th><th>Cuenta</th><th>Nombre</th><th>Origen</th><th>Incluida</th></tr></thead>
                  <tbody>
                    {todas.filter(c => filtroTexto(c)).map(c => ({ c, e: estado(vistaSel, c.cuenta) }))
                      .filter(({ e }) => !soloIncluidas || e !== 'no')
                      .map(({ c, e }) => (
                        <tr key={c.cuenta} className={e === 'quitada' ? 'anulado' : ''}>
                          <td>{c.rubroU}</td><td className="cod">{c.cuenta}</td><td>{c.nombre}</td>
                          <td>{e === 'lista' ? <span className="chip">Lista de la unidad</span>
                            : e === 'agregada' ? <span className="chip ok">Agregada en la vista</span>
                              : e === 'quitada' ? <span className="chip error">Quitada en la vista</span> : ''}</td>
                          <td><input type="checkbox" checked={e === 'lista' || e === 'agregada'}
                            onChange={ev => cambiarVista(vistaSel, c.cuenta, ev.target.checked)} /></td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {modo === 'matriz' && (
        <div className="tarjeta">
          <h3>Cuentas × vistas de {nomUnidad}{sede ? ` · ${nomSede(sede)}` : ''}</h3>
          <p className="sub">✓ = cuenta de la lista de la unidad · + = agregada sólo en esa vista · − = quitada en esa vista. Haga clic en
            una celda para incluir o quitar la cuenta en esa vista.{!sede && vistasU.length > 25 && ' Elija una sede para ver menos columnas.'}</p>
          <div className="scroll" style={{ maxHeight: '65vh' }}>
            <table className="tabla simple matriz">
              <thead>
                <tr><th className="fija">Cuenta</th>
                  {vistasU.map(c => <th key={clave(c)} title={nomVista(c)}>{sede ? '' : <small>{c.sede}<br /></small>}{nomLinea(c.linea)}</th>)}
                </tr>
              </thead>
              <tbody>
                {todas.filter(c => filtroTexto(c) && (!soloIncluidas || listaU.has(c.cuenta) || vistasU.some(v => estado(v, c.cuenta) !== 'no')))
                  .map(c => (
                    <tr key={c.cuenta}>
                      <td className="fija"><span className="cod">{c.cuenta}</span> {c.nombre} <small className="sub">· {c.rubroU}</small></td>
                      {vistasU.map(v => {
                        const e = estado(v, c.cuenta)
                        return (
                          <td key={clave(v)} className={`celda-matriz ${e}`} title={`${nomVista(v)} · ${c.cuenta}`}
                            onClick={() => cambiarVista(v, c.cuenta, !(e === 'lista' || e === 'agregada'))}>
                            {e === 'lista' ? '✓' : e === 'agregada' ? '+' : e === 'quitada' ? '−' : ''}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
