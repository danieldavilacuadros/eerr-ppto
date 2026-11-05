import { Link } from 'react-router-dom'
import { nombreDe, puedeEditar, puedeVer, useDatos } from '../lib/datos'

export default function Inicio() {
  const { perfil, accesos, cat } = useDatos()
  if (!cat || !perfil) return null
  const ppto = cat.escenarios.filter(e => e.tipo === 'ppto')
  const visibles = cat.centros.filter(c => c.activo && puedeVer(perfil, accesos, c))
  const editables = ppto.flatMap(e => visibles.filter(c => puedeEditar(perfil, accesos, e, c)))
  const global = perfil.rol === 'admin' || perfil.rol === 'contabilidad'

  return (
    <div>
      <h1>Hola, {perfil.nombre || perfil.email}</h1>
      <p className="sub">Plataforma de estados de resultados (real y presupuesto) por línea de negocio, sede y marca.</p>

      <div className="tarjetas">
        <Link to="/presupuesto" className="tarjeta accion">
          <h3>Carga de presupuesto</h3>
          <p>{editables.length
            ? `Puede editar ${editables.length} centro(s) de resultado en ${ppto.filter(e => e.estado === 'abierto').map(e => e.nombre).join(', ')}.`
            : 'Consulte el presupuesto de sus líneas.'}</p>
        </Link>
        <Link to="/reportes" className="tarjeta accion">
          <h3>Estados de resultados</h3>
          <p>Real vs presupuesto por mes, acumulado o año, en vista contable o comercial.</p>
        </Link>
      </div>

      <h2>Mi alcance</h2>
      {global ? (
        <p>Su rol ({perfil.rol}) tiene acceso a <strong>todas</strong> las sedes, líneas y marcas.</p>
      ) : accesos.length === 0 ? (
        <div className="alerta">Aún no tiene líneas asignadas. Pida al administrador que configure sus accesos.</div>
      ) : (
        <table className="tabla simple">
          <thead><tr><th>Sede</th><th>Unidad de negocio</th><th>Línea / marca</th><th>Cuentas</th><th>Permiso</th></tr></thead>
          <tbody>
            {accesos.map(a => (
              <tr key={a.id}>
                <td>{a.sede ? nombreDe(cat.sedes, a.sede) : 'Todas'}</td>
                <td>{a.unidad ? nombreDe(cat.unidades, a.unidad) : 'Todas'}</td>
                <td>{a.linea ? nombreDe(cat.lineas, a.linea) : 'Todas'}</td>
                <td>{a.cuenta_prefijo ? `${a.cuenta_prefijo}…` : 'Todas'}</td>
                <td>{a.puede_editar ? <span className="chip ok">Edita presupuesto</span> : <span className="chip">Lectura</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
