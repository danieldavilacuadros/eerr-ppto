import { useEffect, useMemo, useState } from 'react'
import { AGRUPACION_DEFECTO, CONCEPTOS, type Concepto } from '../lib/consolidado'
import { useDatos } from '../lib/datos'
import { supabase } from '../lib/supabase'
import type { Mapeo, Vista } from '../lib/tipos'

/** Contabilidad mantiene aquí a qué rubro (contable y comercial) va cada cuenta mayor. */
export default function Mapeos() {
  const { cat, recargar } = useDatos()
  const [buscar, setBuscar] = useState('')
  const [soloSin, setSoloSin] = useState(false)
  const [msg, setMsg] = useState<{ tipo: string; texto: string } | null>(null)
  const [nueva, setNueva] = useState({ cuenta: '', nombre: '' })
  const [exc, setExc] = useState({ vista: 'comercial' as Vista, cuenta: '', unidad: '', rubro: '' })

  const detalles = useMemo(() => {
    const r = cat?.rubros ?? []
    const nombreSec = new Map(r.map(x => [`${x.vista}|${x.codigo}`, x.nombre]))
    return (v: Vista) => r.filter(x => x.vista === v && x.tipo === 'detalle')
      .map(x => ({ ...x, etiqueta: `${nombreSec.get(`${v}|${x.padre}`) ?? ''} › ${x.nombre}` }))
  }, [cat])
  const base = useMemo(() => {
    const m = new Map<string, Mapeo>()
    for (const x of cat?.mapeos ?? []) if (!x.unidad) m.set(`${x.vista}|${x.cuenta}`, x)
    return m
  }, [cat])

  if (!cat) return null

  async function cambiar(vista: Vista, cuenta: string, rubro: string) {
    setMsg(null)
    const actual = base.get(`${vista}|${cuenta}`)
    const { error } = actual
      ? rubro
        ? await supabase.from('mapeo_cuentas').update({ rubro }).eq('id', actual.id)
        : await supabase.from('mapeo_cuentas').delete().eq('id', actual.id)
      : await supabase.from('mapeo_cuentas').insert({ vista, cuenta, rubro })
    if (error) setMsg({ tipo: 'error', texto: error.message })
    else { setMsg({ tipo: 'ok', texto: `Cuenta ${cuenta} actualizada (${vista}).` }); recargar() }
  }

  async function crearCuenta() {
    if (!/^\d{7}$/.test(nueva.cuenta) || !nueva.nombre.trim()) return
    const { error } = await supabase.from('cuentas').insert({ cuenta: nueva.cuenta, nombre: nueva.nombre.trim().toUpperCase(), clase: nueva.cuenta[0] })
    if (error) setMsg({ tipo: 'error', texto: error.message })
    else { setNueva({ cuenta: '', nombre: '' }); recargar() }
  }

  async function crearExcepcion() {
    if (!exc.cuenta || !exc.unidad || !exc.rubro) return
    const { error } = await supabase.from('mapeo_cuentas').insert(exc)
    if (error) setMsg({ tipo: 'error', texto: error.message }); else recargar()
  }
  async function borrarExcepcion(id: number) {
    const { error } = await supabase.from('mapeo_cuentas').delete().eq('id', id)
    if (error) setMsg({ tipo: 'error', texto: error.message }); else recargar()
  }

  const f = buscar.trim().toLowerCase()
  const lista = cat.cuentas.filter(c => !c.es_estadistica)
    .filter(c => !f || c.cuenta.includes(f) || c.nombre.toLowerCase().includes(f))
    .filter(c => !soloSin || !base.has(`contable|${c.cuenta}`) || !base.has(`comercial|${c.cuenta}`))
  const excepciones = cat.mapeos.filter(m => m.unidad)
  const nombreRubro = (v: Vista, c: string) => cat.rubros.find(r => r.vista === v && r.codigo === c)?.nombre ?? c
  const sinCount = cat.cuentas.filter(c => !c.es_estadistica && (!base.has(`contable|${c.cuenta}`) || !base.has(`comercial|${c.cuenta}`))).length

  return (
    <div>
      <h1>Mapeo de cuentas mayores</h1>
      <p className="sub">Cada cuenta debe tener un rubro en la vista contable y en la comercial; así ambos reportes cuadran. {sinCount > 0 &&
        <span className="chip error">{sinCount} cuenta(s) sin clasificar</span>}</p>
      {msg && <div className={`alerta ${msg.tipo}`}>{msg.texto}</div>}

      <div className="tarjeta">
        <div className="barra">
          <input className="buscar" placeholder="Buscar cuenta o nombre…" value={buscar} onChange={e => setBuscar(e.target.value)} />
          <label className="check"><input type="checkbox" checked={soloSin} onChange={e => setSoloSin(e.target.checked)} /> Solo sin clasificar</label>
          <div className="espacio" />
          <input placeholder="Nueva cuenta (7 dígitos)" value={nueva.cuenta} onChange={e => setNueva({ ...nueva, cuenta: e.target.value.trim() })} style={{ width: 170 }} />
          <input placeholder="Nombre" value={nueva.nombre} onChange={e => setNueva({ ...nueva, nombre: e.target.value })} />
          <button onClick={crearCuenta}>Crear cuenta</button>
        </div>
        <div className="scroll" style={{ maxHeight: '60vh' }}>
          <table className="tabla simple">
            <thead><tr><th>Cuenta</th><th>Nombre</th><th>Rubro vista contable</th><th>Rubro vista comercial</th></tr></thead>
            <tbody>
              {lista.map(c => (
                <tr key={c.cuenta}>
                  <td className="cod">{c.cuenta}</td>
                  <td>{c.nombre}</td>
                  {(['contable', 'comercial'] as Vista[]).map(v => (
                    <td key={v}>
                      <select className={base.has(`${v}|${c.cuenta}`) ? '' : 'falta'} value={base.get(`${v}|${c.cuenta}`)?.rubro ?? ''}
                        onChange={e => cambiar(v, c.cuenta, e.target.value)}>
                        <option value="">— sin clasificar —</option>
                        {detalles(v).map(r => <option key={r.codigo} value={r.codigo}>{r.etiqueta}</option>)}
                      </select>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="tarjeta">
        <h3>Excepciones por unidad de negocio</h3>
        <p className="sub">Cuando una cuenta va a un rubro distinto según la unidad (ej. 704 en Taller = Ventas del taller).</p>
        <div className="filtros">
          <select value={exc.vista} onChange={e => setExc({ ...exc, vista: e.target.value as Vista, rubro: '' })}>
            <option value="comercial">Comercial</option><option value="contable">Contable</option>
          </select>
          <input list="ctas-map" placeholder="Cuenta" value={exc.cuenta} onChange={e => setExc({ ...exc, cuenta: e.target.value.split(' ')[0] })} />
          <datalist id="ctas-map">{cat.cuentas.map(c => <option key={c.cuenta} value={`${c.cuenta} ${c.nombre}`} />)}</datalist>
          <select value={exc.unidad} onChange={e => setExc({ ...exc, unidad: e.target.value })}>
            <option value="">Unidad…</option>
            {cat.unidades.map(u => <option key={u.codigo} value={u.codigo}>{u.nombre}</option>)}
          </select>
          <select value={exc.rubro} onChange={e => setExc({ ...exc, rubro: e.target.value })}>
            <option value="">Rubro…</option>
            {detalles(exc.vista).map(r => <option key={r.codigo} value={r.codigo}>{r.etiqueta}</option>)}
          </select>
          <button onClick={crearExcepcion}>Agregar excepción</button>
        </div>
        <table className="tabla simple">
          <thead><tr><th>Vista</th><th>Cuenta</th><th>Unidad</th><th>Rubro</th><th /></tr></thead>
          <tbody>
            {excepciones.map(m => (
              <tr key={m.id}>
                <td>{m.vista}</td><td className="cod">{m.cuenta}</td><td>{m.unidad}</td><td>{nombreRubro(m.vista, m.rubro)}</td>
                <td><button className="link" onClick={() => borrarExcepcion(m.id)}>Quitar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AgrupacionConsolidada />
    </div>
  )
}

/** Mantenimiento: a qué concepto de la vista consolidada va cada sección de la vista comercial. */
function AgrupacionConsolidada() {
  const { cat } = useDatos()
  const [agr, setAgr] = useState<Record<string, Concepto> | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    supabase.from('consolidado_secciones').select('seccion, concepto').then(({ data, error }) => {
      if (error) { setMsg('Falta ejecutar la migración 003 en Supabase.'); setAgr({ ...AGRUPACION_DEFECTO }); return }
      setAgr({ ...AGRUPACION_DEFECTO, ...Object.fromEntries((data ?? []).map(r => [r.seccion, r.concepto as Concepto])) })
    })
  }, [])
  if (!cat || !agr) return null
  const secciones = cat.rubros.filter(r => r.vista === 'comercial' && r.tipo === 'seccion').sort((a, b) => a.orden - b.orden)
  async function cambiar(seccion: string, concepto: Concepto) {
    setAgr(a => ({ ...a!, [seccion]: concepto }))
    const { error } = await supabase.from('consolidado_secciones').upsert({ seccion, concepto, updated_at: new Date().toISOString() })
    setMsg(error ? error.message : 'Guardado.')
  }
  return (
    <div className="tarjeta">
      <h3>Agrupación de la vista consolidada</h3>
      <p className="sub">Define cómo se arma la vista consolidada de Estados de resultados (Ingresos, Costos, Margen bruto, Gastos, Margen de contribución y,
        en la vista general, hasta el Resultado operativo neto). Cada sección comercial reúne los rubros a los que se asignan las cuentas arriba;
        una cuenta nueva sólo necesita su rubro para entrar en la agrupación.</p>
      {msg && <div className="alerta">{msg}</div>}
      <table className="tabla simple">
        <thead><tr><th>Sección (vista comercial)</th><th>Rubros</th><th>Concepto consolidado</th></tr></thead>
        <tbody>
          {secciones.map(s => (
            <tr key={s.codigo}>
              <td><strong>{s.nombre}</strong></td>
              <td className="ayuda">{cat.rubros.filter(r => r.vista === 'comercial' && r.padre === s.codigo).map(r => r.nombre).join(' · ')}</td>
              <td>
                <select value={agr[s.codigo] ?? 'NO_INCLUIR'} onChange={e => cambiar(s.codigo, e.target.value as Concepto)}>
                  {CONCEPTOS.map(c => <option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
