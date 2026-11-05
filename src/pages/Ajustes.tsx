import { useCallback, useEffect, useMemo, useState } from 'react'
import { nombreDe, useDatos } from '../lib/datos'
import { MESES_LARGOS, num, parseNumero } from '../lib/formato'
import { supabase } from '../lib/supabase'
import SelectorCentro, { type CentroSel } from '../components/SelectorCentro'

interface Ajuste {
  id: number
  escenario_id: number
  anio: number
  mes: number
  tipo: 'provision' | 'reclasificacion' | 'asignacion'
  descripcion: string
  estado: string
  created_at: string
  ajuste_lineas: Linea[]
}
interface Linea { sede: string; unidad: string; linea: string; cuenta: string; monto: number }

const TIPOS = {
  provision: 'Provisión',
  reclasificacion: 'Reclasificación (suma cero)',
  asignacion: 'Asignación / distribución',
}

const lineaVacia = (): CentroSel & { cuenta: string; monto: string } => ({ sede: '', unidad: '', linea: '', cuenta: '', monto: '' })

export default function Ajustes() {
  const { cat } = useDatos()
  const [escId, setEscId] = useState<number | undefined>(cat?.escenarios[0]?.id)
  const esc = cat?.escenarios.find(e => e.id === escId)
  const [lista, setLista] = useState<Ajuste[] | null>(null)
  const [nuevo, setNuevo] = useState(false)
  const [mes, setMes] = useState(new Date().getMonth() + 1)
  const [tipo, setTipo] = useState<keyof typeof TIPOS>('provision')
  const [desc, setDesc] = useState('')
  const [lineas, setLineas] = useState([lineaVacia(), lineaVacia()])
  const [msg, setMsg] = useState<{ tipo: string; texto: string } | null>(null)

  const cargar = useCallback(async () => {
    if (!escId) return
    const { data, error } = await supabase.from('ajustes').select('*, ajuste_lineas(*)')
      .eq('escenario_id', escId).order('created_at', { ascending: false })
    if (error) setMsg({ tipo: 'error', texto: error.message })
    else setLista(data as Ajuste[])
  }, [escId])
  useEffect(() => { cargar() }, [cargar])

  const cuentas = useMemo(() => new Map((cat?.cuentas ?? []).map(c => [c.cuenta, c])), [cat])
  if (!cat) return null

  const montos = lineas.map(l => parseNumero(l.monto) ?? 0)
  const total = montos.reduce((a, b) => a + b, 0)
  const validas = lineas.filter(l => l.sede && l.unidad && l.linea && cuentas.has(l.cuenta.split(' ')[0]) && parseNumero(l.monto))
  const puedeGuardar = esc && desc.trim() && validas.length && (tipo !== 'reclasificacion' || Math.abs(total) < 0.01)

  async function guardar() {
    if (!esc || !puedeGuardar) return
    setMsg(null)
    const { data, error } = await supabase.from('ajustes')
      .insert({ escenario_id: esc.id, anio: esc.anio, mes, tipo, descripcion: desc.trim() }).select('id').single()
    if (error) { setMsg({ tipo: 'error', texto: error.message }); return }
    const { error: e2 } = await supabase.from('ajuste_lineas').insert(validas.map(l => ({
      ajuste_id: data.id, sede: l.sede, unidad: l.unidad, linea: l.linea,
      cuenta: l.cuenta.split(' ')[0], monto: parseNumero(l.monto),
    })))
    if (e2) { setMsg({ tipo: 'error', texto: e2.message }); return }
    setMsg({ tipo: 'ok', texto: 'Ajuste registrado.' })
    setNuevo(false); setDesc(''); setLineas([lineaVacia(), lineaVacia()])
    cargar()
  }

  async function anular(id: number) {
    if (!confirm('¿Anular este ajuste? Dejará de sumarse en los reportes.')) return
    const { error } = await supabase.from('ajustes').update({ estado: 'anulado' }).eq('id', id)
    if (error) setMsg({ tipo: 'error', texto: error.message }); else cargar()
  }

  return (
    <div>
      <div className="encabezado">
        <div>
          <h1>Ajustes y provisiones</h1>
          <p className="sub">Provisiones, reclasificaciones y asignaciones de contabilidad sobre cuentas mayores. Se suman al real o al presupuesto en los reportes.</p>
        </div>
        <div className="filtros">
          <label>Escenario
            <select value={escId} onChange={e => setEscId(Number(e.target.value))}>
              {cat.escenarios.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </select>
          </label>
          <button className="primario" onClick={() => setNuevo(v => !v)}>{nuevo ? 'Cancelar' : 'Nuevo ajuste'}</button>
        </div>
      </div>
      {msg && <div className={`alerta ${msg.tipo}`}>{msg.texto}</div>}

      {nuevo && (
        <div className="tarjeta">
          <div className="filtros">
            <label>Mes<select value={mes} onChange={e => setMes(Number(e.target.value))}>
              {MESES_LARGOS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
            <label>Tipo<select value={tipo} onChange={e => setTipo(e.target.value as keyof typeof TIPOS)}>
              {Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label style={{ flex: 1 }}>Descripción<input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Ej. Provisión de bono de marca setiembre" /></label>
          </div>
          <datalist id="ctas-ajuste">
            {cat.cuentas.filter(c => !c.es_estadistica).map(c => <option key={c.cuenta} value={`${c.cuenta} ${c.nombre}`} />)}
          </datalist>
          <table className="tabla simple">
            <thead><tr><th>Centro (sede / unidad / línea)</th><th>Cuenta mayor</th><th className="n">Monto (signo de resultado)</th><th /></tr></thead>
            <tbody>
              {lineas.map((l, i) => (
                <tr key={i}>
                  <td className="fila-selects"><SelectorCentro valor={l} onCambio={c => setLineas(ls => ls.map((x, j) => j === i ? { ...x, ...c } : x))} /></td>
                  <td><input list="ctas-ajuste" value={l.cuenta} onChange={e => setLineas(ls => ls.map((x, j) => j === i ? { ...x, cuenta: e.target.value } : x))} /></td>
                  <td><input className="n" value={l.monto} placeholder="-1,500.00" onChange={e => setLineas(ls => ls.map((x, j) => j === i ? { ...x, monto: e.target.value } : x))} /></td>
                  <td><button className="link" onClick={() => setLineas(ls => ls.filter((_, j) => j !== i))}>Quitar</button></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={2}><button className="link" onClick={() => setLineas(ls => [...ls, lineaVacia()])}>+ Agregar línea</button></td>
                <td className="n b">{num(total)}</td><td /></tr>
            </tfoot>
          </table>
          <p className="ayuda">Monto con signo de resultado: ingresos positivos, gastos negativos. Una reclasificación debe sumar cero.</p>
          <button className="primario" disabled={!puedeGuardar} onClick={guardar}>Registrar ajuste</button>
        </div>
      )}

      <div className="tarjeta">
        {!lista ? <p>Cargando…</p> : !lista.length ? <p>No hay ajustes en este escenario.</p> : (
          <table className="tabla simple">
            <thead><tr><th>Mes</th><th>Tipo</th><th>Descripción</th><th>Detalle</th><th className="n">Neto</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {lista.map(a => (
                <tr key={a.id} className={a.estado === 'anulado' ? 'anulado' : ''}>
                  <td>{MESES_LARGOS[a.mes - 1]} {a.anio}</td>
                  <td>{TIPOS[a.tipo]}</td>
                  <td>{a.descripcion}</td>
                  <td className="pequeno">{a.ajuste_lineas.map((l, i) => (
                    <div key={i}>{nombreDe(cat.sedes, l.sede)} · {l.unidad} · {l.linea} · {l.cuenta} {cuentas.get(l.cuenta)?.nombre}: <strong>{num(l.monto)}</strong></div>
                  ))}</td>
                  <td className="n">{num(a.ajuste_lineas.reduce((s, l) => s + Number(l.monto), 0))}</td>
                  <td>{a.estado}</td>
                  <td>{a.estado !== 'anulado' && <button className="link" onClick={() => anular(a.id)}>Anular</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
