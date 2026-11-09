import { useMemo, useState } from 'react'
import { useDatos } from '../lib/datos'
import { supabase } from '../lib/supabase'

/**
 * Mapa de cuentas (Excel "MAPA DE CUENTAS - ok"): cada cuenta mayor tiene el nombre que se muestra y un rubro.
 * El mismo mapa vale para todas las sedes, unidades, líneas y marcas; los esquemas 1 y 2 se arman con esos rubros.
 */
export default function Mapeos() {
  const { cat, recargar } = useDatos()
  const [buscar, setBuscar] = useState('')
  const [soloSin, setSoloSin] = useState(false)
  const [rubroFiltro, setRubroFiltro] = useState('')
  const [msg, setMsg] = useState<{ tipo: string; texto: string } | null>(null)
  const [nueva, setNueva] = useState({ cuenta: '', nombre: '', rubro: '' })
  const [exc, setExc] = useState({ cuenta: '', unidad: '', rubro: '' })
  const [nuevoRubro, setNuevoRubro] = useState('')

  const usoRubro = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const f of cat?.esquemas ?? []) if (f.rubro) { if (!m.has(f.rubro)) m.set(f.rubro, new Set()); m.get(f.rubro)!.add(f.esquema) }
    return m
  }, [cat])

  if (!cat) return null
  const ok = (texto: string) => { setMsg({ tipo: 'ok', texto }); recargar() }
  const falla = (e: { message: string }) => setMsg({ tipo: 'error', texto: e.message })

  async function cambiarRubro(cuenta: string, rubro: string) {
    const { error } = await supabase.from('cuentas').update({ rubro: rubro || null }).eq('cuenta', cuenta)
    if (error) falla(error); else ok(`Cuenta ${cuenta}: rubro ${rubro || '(sin rubro)'}.`)
  }
  async function cambiarNombre(cuenta: string, nombre: string, anterior: string) {
    const n = nombre.trim().toUpperCase()
    if (!n || n === anterior) return
    const { error } = await supabase.from('cuentas').update({ nombre: n }).eq('cuenta', cuenta)
    if (error) falla(error); else ok(`Cuenta ${cuenta}: nombre actualizado.`)
  }
  async function crearCuenta() {
    if (!/^\d{7}$/.test(nueva.cuenta) || !nueva.nombre.trim()) return setMsg({ tipo: 'error', texto: 'La cuenta debe tener 7 dígitos y un nombre.' })
    const { error } = await supabase.from('cuentas').insert({
      cuenta: nueva.cuenta, nombre: nueva.nombre.trim().toUpperCase(), clase: nueva.cuenta[0], rubro: nueva.rubro || null,
    })
    if (error) falla(error); else { setNueva({ cuenta: '', nombre: '', rubro: '' }); ok(`Cuenta ${nueva.cuenta} creada.`) }
  }
  async function crearExcepcion() {
    if (!exc.cuenta || !exc.unidad || !exc.rubro) return
    const { error } = await supabase.from('mapa_excepciones').upsert(exc)
    if (error) falla(error); else { setExc({ cuenta: '', unidad: '', rubro: '' }); ok('Excepción guardada.') }
  }
  async function borrarExcepcion(cuenta: string, unidad: string) {
    const { error } = await supabase.from('mapa_excepciones').delete().eq('cuenta', cuenta).eq('unidad', unidad)
    if (error) falla(error); else ok('Excepción quitada.')
  }
  async function crearRubro() {
    const codigo = nuevoRubro.trim().toUpperCase()
    if (!codigo) return
    const { error } = await supabase.from('rubros_eerr').insert({ codigo, orden: cat!.rubros.length + 1 })
    if (error) falla(error); else { setNuevoRubro(''); ok(`Rubro ${codigo} creado. Para que aparezca en los reportes hay que agregarlo a los esquemas.`) }
  }

  const f = buscar.trim().toLowerCase()
  const lista = cat.cuentas.filter(c => !c.es_estadistica)
    .filter(c => !f || c.cuenta.includes(f) || c.nombre.toLowerCase().includes(f))
    .filter(c => !soloSin || !c.rubro || !usoRubro.has(c.rubro))
    .filter(c => !rubroFiltro || c.rubro === rubroFiltro)
  const sinCount = cat.cuentas.filter(c => !c.es_estadistica && (!c.rubro || !usoRubro.has(c.rubro))).length
  const cuentasPorRubro = new Map<string, number>()
  for (const c of cat.cuentas) if (c.rubro) cuentasPorRubro.set(c.rubro, (cuentasPorRubro.get(c.rubro) ?? 0) + 1)
  const opcionesRubro = cat.rubros.map(r => <option key={r.codigo} value={r.codigo}>{r.codigo}</option>)

  return (
    <div>
      <h1>Mapa de cuentas</h1>
      <p className="sub">Cada cuenta mayor tiene el nombre que se muestra y su rubro. El mismo mapa se usa para todas las sedes, unidades,
        líneas y marcas, en el real y en el presupuesto. {sinCount > 0 && <span className="chip error">{sinCount} cuenta(s) sin rubro</span>}</p>
      {msg && <div className={`alerta ${msg.tipo}`}>{msg.texto}</div>}

      <div className="tarjeta">
        <div className="barra">
          <input className="buscar" placeholder="Buscar cuenta o nombre…" value={buscar} onChange={e => setBuscar(e.target.value)} />
          <select value={rubroFiltro} onChange={e => setRubroFiltro(e.target.value)}>
            <option value="">Todos los rubros</option>{opcionesRubro}
          </select>
          <label className="check"><input type="checkbox" checked={soloSin} onChange={e => setSoloSin(e.target.checked)} /> Solo sin rubro</label>
          <span className="ayuda">{lista.length} cuenta(s)</span>
        </div>
        <div className="scroll" style={{ maxHeight: '60vh' }}>
          <table className="tabla simple">
            <thead><tr><th>Cuenta</th><th>Nombre a mostrar</th><th>Rubro</th></tr></thead>
            <tbody>
              {lista.map(c => (
                <tr key={c.cuenta}>
                  <td className="cod">{c.cuenta}</td>
                  <td><input key={c.nombre} defaultValue={c.nombre} style={{ width: '100%' }}
                    onBlur={e => cambiarNombre(c.cuenta, e.target.value, c.nombre)} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} /></td>
                  <td>
                    <select className={c.rubro && usoRubro.has(c.rubro) ? '' : 'falta'} value={c.rubro ?? ''} onChange={e => cambiarRubro(c.cuenta, e.target.value)}>
                      <option value="">— sin rubro —</option>{opcionesRubro}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td><input placeholder="7 dígitos" value={nueva.cuenta} style={{ width: 90 }} onChange={e => setNueva({ ...nueva, cuenta: e.target.value.trim() })} /></td>
                <td><input placeholder="Nombre de la cuenta nueva" value={nueva.nombre} style={{ width: '100%' }} onChange={e => setNueva({ ...nueva, nombre: e.target.value })} /></td>
                <td>
                  <select value={nueva.rubro} onChange={e => setNueva({ ...nueva, rubro: e.target.value })}><option value="">Rubro…</option>{opcionesRubro}</select>{' '}
                  <button onClick={crearCuenta}>Crear cuenta</button>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="dos-columnas">
        <div className="tarjeta">
          <h3>Excepciones por unidad de negocio</h3>
          <p className="sub">Sólo para cuentas que en una unidad van a otro rubro (ej. 7599100 en Venta de unidades = Incentivo fuerza de ventas).</p>
          <table className="tabla simple">
            <thead><tr><th>Cuenta</th><th>Unidad</th><th>Rubro</th><th /></tr></thead>
            <tbody>
              {cat.excepciones.map(x => (
                <tr key={`${x.cuenta}|${x.unidad}`}>
                  <td className="cod">{x.cuenta}</td><td>{cat.unidades.find(u => u.codigo === x.unidad)?.nombre ?? x.unidad}</td><td>{x.rubro}</td>
                  <td><button className="link" onClick={() => borrarExcepcion(x.cuenta, x.unidad)}>Quitar</button></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td><input list="ctas-map" placeholder="Cuenta" value={exc.cuenta} style={{ width: 90 }} onChange={e => setExc({ ...exc, cuenta: e.target.value.split(' ')[0] })} />
                  <datalist id="ctas-map">{cat.cuentas.map(c => <option key={c.cuenta} value={`${c.cuenta} ${c.nombre}`} />)}</datalist></td>
                <td><select value={exc.unidad} onChange={e => setExc({ ...exc, unidad: e.target.value })}>
                  <option value="">Unidad…</option>{cat.unidades.map(u => <option key={u.codigo} value={u.codigo}>{u.nombre}</option>)}</select></td>
                <td><select value={exc.rubro} onChange={e => setExc({ ...exc, rubro: e.target.value })}><option value="">Rubro…</option>{opcionesRubro}</select></td>
                <td><button onClick={crearExcepcion}>Agregar</button></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="tarjeta">
          <h3>Rubros ({cat.rubros.length})</h3>
          <p className="sub">Un rubro que no está en los esquemas no aparece en los reportes (sus cuentas quedan como "sin rubro").</p>
          <div className="scroll" style={{ maxHeight: '45vh' }}>
            <table className="tabla simple">
              <thead><tr><th>Rubro</th><th className="n">Cuentas</th><th>Esquemas</th></tr></thead>
              <tbody>
                {cat.rubros.map(r => (
                  <tr key={r.codigo} className="clic" onClick={() => setRubroFiltro(r.codigo)} title="Ver sus cuentas">
                    <td>{r.codigo}</td>
                    <td className="n">{cuentasPorRubro.get(r.codigo) ?? 0}</td>
                    <td>{usoRubro.has(r.codigo) ? [...usoRubro.get(r.codigo)!].sort().map(e => <span key={e} className="chip azul">{e === 'E1' ? 'Esquema 1' : 'Esquema 2'}</span>)
                      : <span className="chip error">No está en los esquemas</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="barra" style={{ marginTop: 8 }}>
            <input placeholder="Nuevo rubro" value={nuevoRubro} onChange={e => setNuevoRubro(e.target.value)} />
            <button onClick={crearRubro}>Crear rubro</button>
          </div>
        </div>
      </div>
    </div>
  )
}
