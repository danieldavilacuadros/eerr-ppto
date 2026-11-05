import { useCallback, useEffect, useState } from 'react'
import { nombreDe, useDatos } from '../lib/datos'
import { supabase } from '../lib/supabase'
import type { Acceso, Perfil, Rol } from '../lib/tipos'

const ROLES: { v: Rol; t: string }[] = [
  { v: 'lectura', t: 'Solo lectura' },
  { v: 'jefe', t: 'Jefe (edita presupuesto)' },
  { v: 'contabilidad', t: 'Contabilidad' },
  { v: 'admin', t: 'Administrador' },
]

const accesoVacio = { sede: '', unidad: '', linea: '', cuenta_prefijo: '', puede_editar: true }

export default function Usuarios() {
  const { cat, recargar } = useDatos()
  const [perfiles, setPerfiles] = useState<Perfil[]>([])
  const [accesos, setAccesos] = useState<Acceso[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [nuevo, setNuevo] = useState(accesoVacio)
  const [msg, setMsg] = useState<{ tipo: string; texto: string } | null>(null)
  const [esc, setEsc] = useState({ codigo: '', nombre: '', anio: new Date().getFullYear() + 1, tipo: 'ppto' })

  const cargar = useCallback(async () => {
    const [p, a] = await Promise.all([
      supabase.from('perfiles').select('*').order('email'),
      supabase.from('accesos').select('*'),
    ])
    if (p.error || a.error) setMsg({ tipo: 'error', texto: (p.error ?? a.error)!.message })
    setPerfiles((p.data ?? []) as Perfil[])
    setAccesos((a.data ?? []) as Acceso[])
  }, [])
  useEffect(() => { cargar() }, [cargar])

  if (!cat) return null
  const perfil = perfiles.find(p => p.id === sel)

  async function actualizar(id: string, cambios: Partial<Perfil>) {
    const { error } = await supabase.from('perfiles').update(cambios).eq('id', id)
    if (error) setMsg({ tipo: 'error', texto: error.message }); else cargar()
  }

  async function agregarAcceso() {
    if (!sel) return
    const fila = {
      perfil_id: sel, sede: nuevo.sede || null, unidad: nuevo.unidad || null, linea: nuevo.linea || null,
      cuenta_prefijo: nuevo.cuenta_prefijo.trim() || null, puede_editar: nuevo.puede_editar,
    }
    const { error } = await supabase.from('accesos').insert(fila)
    if (error) setMsg({ tipo: 'error', texto: error.message }); else { setNuevo(accesoVacio); cargar() }
  }

  async function quitarAcceso(id: number) {
    const { error } = await supabase.from('accesos').delete().eq('id', id)
    if (error) setMsg({ tipo: 'error', texto: error.message }); else cargar()
  }

  async function crearEscenario() {
    if (!esc.codigo || !esc.nombre) return
    const { error } = await supabase.from('escenarios').insert({ ...esc, codigo: esc.codigo.toUpperCase(), estado: 'abierto' })
    if (error) setMsg({ tipo: 'error', texto: error.message }); else { setEsc({ ...esc, codigo: '', nombre: '' }); recargar() }
  }
  async function estadoEscenario(id: number, estado: string) {
    const { error } = await supabase.from('escenarios').update({ estado }).eq('id', id)
    if (error) setMsg({ tipo: 'error', texto: error.message }); else recargar()
  }

  return (
    <div>
      <h1>Usuarios y accesos</h1>
      <p className="sub">Los usuarios se invitan desde Supabase (Authentication › Users › Invite user). Al ingresar por primera vez aparecen aquí
        como «Solo lectura» sin alcance; asígneles rol y líneas.</p>
      {msg && <div className={`alerta ${msg.tipo}`}>{msg.texto}</div>}

      <div className="dos-columnas">
        <div className="tarjeta">
          <table className="tabla simple">
            <thead><tr><th>Usuario</th><th>Rol</th><th>Activo</th></tr></thead>
            <tbody>
              {perfiles.map(p => (
                <tr key={p.id} className={`clic${p.id === sel ? ' seleccionada' : ''}`} onClick={() => setSel(p.id)}>
                  <td><div>{p.nombre}</div><small>{p.email}</small></td>
                  <td>
                    <select value={p.rol} onClick={e => e.stopPropagation()} onChange={e => actualizar(p.id, { rol: e.target.value as Rol })}>
                      {ROLES.map(r => <option key={r.v} value={r.v}>{r.t}</option>)}
                    </select>
                  </td>
                  <td><input type="checkbox" checked={p.activo} onClick={e => e.stopPropagation()} onChange={e => actualizar(p.id, { activo: e.target.checked })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="tarjeta">
          {!perfil ? <p className="sub">Seleccione un usuario para ver y editar su alcance.</p> : (
            <>
              <h3>{perfil.nombre || perfil.email}</h3>
              <div className="filtros">
                <label>Nombre<input defaultValue={perfil.nombre ?? ''} onBlur={e => actualizar(perfil.id, { nombre: e.target.value })} /></label>
                <label>Cargo<input defaultValue={perfil.cargo ?? ''} placeholder="Jefe de intermediación financiera" onBlur={e => actualizar(perfil.id, { cargo: e.target.value })} /></label>
              </div>
              {(perfil.rol === 'admin' || perfil.rol === 'contabilidad') &&
                <div className="alerta">Este rol ve todas las sedes y líneas. Los accesos de abajo sólo definen dónde puede editar presupuesto (contabilidad).</div>}
              <table className="tabla simple">
                <thead><tr><th>Sede</th><th>Unidad</th><th>Línea</th><th>Cuentas</th><th>Edita ppto</th><th /></tr></thead>
                <tbody>
                  {accesos.filter(a => a.perfil_id === perfil.id).map(a => (
                    <tr key={a.id}>
                      <td>{a.sede ? nombreDe(cat.sedes, a.sede) : 'Todas'}</td>
                      <td>{a.unidad ? nombreDe(cat.unidades, a.unidad) : 'Todas'}</td>
                      <td>{a.linea ? nombreDe(cat.lineas, a.linea) : 'Todas'}</td>
                      <td>{a.cuenta_prefijo ? `${a.cuenta_prefijo}…` : 'Todas'}</td>
                      <td>{a.puede_editar ? 'Sí' : 'No'}</td>
                      <td><button className="link" onClick={() => quitarAcceso(a.id)}>Quitar</button></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td><select value={nuevo.sede} onChange={e => setNuevo({ ...nuevo, sede: e.target.value })}>
                      <option value="">Todas</option>{cat.sedes.map(s => <option key={s.codigo} value={s.codigo}>{s.nombre}</option>)}</select></td>
                    <td><select value={nuevo.unidad} onChange={e => setNuevo({ ...nuevo, unidad: e.target.value })}>
                      <option value="">Todas</option>{cat.unidades.map(u => <option key={u.codigo} value={u.codigo}>{u.nombre}</option>)}</select></td>
                    <td><select value={nuevo.linea} onChange={e => setNuevo({ ...nuevo, linea: e.target.value })}>
                      <option value="">Todas</option>{cat.lineas.map(l => <option key={l.codigo} value={l.codigo}>{l.nombre}</option>)}</select></td>
                    <td><input placeholder="ej. 7521" value={nuevo.cuenta_prefijo} style={{ width: 80 }} onChange={e => setNuevo({ ...nuevo, cuenta_prefijo: e.target.value })} /></td>
                    <td><input type="checkbox" checked={nuevo.puede_editar} onChange={e => setNuevo({ ...nuevo, puede_editar: e.target.checked })} /></td>
                    <td><button onClick={agregarAcceso}>Agregar</button></td>
                  </tr>
                </tfoot>
              </table>
              <p className="ayuda">Ejemplos: jefe de intermediación financiera → Unidad «Intermediación financiera» y «Equipamiento y accesorios», todas las sedes, edita.
                Jefe de unidades Cusco → Sede Cusco + Unidad «Venta de unidades» + cada marca suya (una fila por marca), y Cusco + «Intermediación financiera» sin editar para ver lo que le corresponde.</p>
            </>
          )}
        </div>
      </div>

      <div className="tarjeta">
        <h3>Escenarios</h3>
        <table className="tabla simple">
          <thead><tr><th>Código</th><th>Nombre</th><th>Año</th><th>Tipo</th><th>Estado</th></tr></thead>
          <tbody>
            {cat.escenarios.map(e => (
              <tr key={e.id}>
                <td className="cod">{e.codigo}</td><td>{e.nombre}</td><td>{e.anio}</td><td>{e.tipo}</td>
                <td><select value={e.estado} onChange={x => estadoEscenario(e.id, x.target.value)}>
                  <option value="abierto">Abierto</option><option value="cerrado">Cerrado</option></select></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td><input placeholder="PPTO_2027_V2" value={esc.codigo} onChange={e => setEsc({ ...esc, codigo: e.target.value })} /></td>
              <td><input placeholder="Presupuesto 2027 (revisión)" value={esc.nombre} onChange={e => setEsc({ ...esc, nombre: e.target.value })} /></td>
              <td><input type="number" value={esc.anio} style={{ width: 80 }} onChange={e => setEsc({ ...esc, anio: Number(e.target.value) })} /></td>
              <td><select value={esc.tipo} onChange={e => setEsc({ ...esc, tipo: e.target.value })}>
                <option value="ppto">Presupuesto</option><option value="real">Real</option></select></td>
              <td><button onClick={crearEscenario}>Crear</button></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
