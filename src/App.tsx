import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { configurado, supabase } from './lib/supabase'
import { esRol, useDatos } from './lib/datos'
import Login from './pages/Login'
import Inicio from './pages/Inicio'
import Presupuesto from './pages/Presupuesto'
import Reportes from './pages/Reportes'
import Ajustes from './pages/Ajustes'
import CargaReal from './pages/CargaReal'
import Mapeos from './pages/Mapeos'
import Usuarios from './pages/Usuarios'

const ROL_NOMBRE: Record<string, string> = {
  admin: 'Administrador', contabilidad: 'Contabilidad', jefe: 'Jefe de línea', lectura: 'Solo lectura',
}

export default function App() {
  const { session, cargando, perfil, error, cat } = useDatos()

  if (!configurado) {
    return (
      <div className="centrado">
        <div className="tarjeta" style={{ maxWidth: 560 }}>
          <h2>Falta configurar Supabase</h2>
          <p>Cree el archivo <code>.env.local</code> (ver <code>.env.example</code>) con <code>VITE_SUPABASE_URL</code> y{' '}
            <code>VITE_SUPABASE_ANON_KEY</code>, o configúrelos como <em>secrets</em> del repositorio en GitHub.</p>
        </div>
      </div>
    )
  }
  if (!session) return <Login />
  if (cargando && !cat) return <div className="centrado">Cargando…</div>
  if (error) return <div className="centrado"><div className="alerta error">Error: {error}</div></div>
  if (!perfil?.activo) {
    return (
      <div className="centrado">
        <div className="tarjeta" style={{ maxWidth: 480 }}>
          <h2>Usuario sin activar</h2>
          <p>Su usuario ({session.user.email}) fue creado pero aún no tiene permisos. Pida al administrador que le asigne un rol y sus líneas.</p>
          <button onClick={() => supabase.auth.signOut()}>Cerrar sesión</button>
        </div>
      </div>
    )
  }

  const contab = esRol(perfil, 'admin', 'contabilidad')
  return (
    <div className="app">
      <aside className="lateral">
        <div className="marca">
          <span className="logo">IM</span>
          <div>
            <strong>Incamotors</strong>
            <small>EERR y Presupuesto</small>
          </div>
        </div>
        <nav>
          <NavLink to="/" end>Inicio</NavLink>
          <NavLink to="/presupuesto">Carga de presupuesto</NavLink>
          <NavLink to="/reportes">Estados de resultados</NavLink>
          {contab && <div className="nav-titulo">Contabilidad</div>}
          {contab && <NavLink to="/ajustes">Ajustes y provisiones</NavLink>}
          {contab && <NavLink to="/carga-real">Carga real (SAP)</NavLink>}
          {contab && <NavLink to="/mapeos">Mapeo de cuentas</NavLink>}
          {esRol(perfil, 'admin') && <div className="nav-titulo">Administración</div>}
          {esRol(perfil, 'admin') && <NavLink to="/usuarios">Usuarios y accesos</NavLink>}
        </nav>
        <div className="usuario">
          <div className="usuario-nombre">{perfil.nombre || perfil.email}</div>
          <div className="usuario-rol">{ROL_NOMBRE[perfil.rol]}{perfil.cargo ? ` · ${perfil.cargo}` : ''}</div>
          <button className="link" onClick={() => supabase.auth.signOut()}>Cerrar sesión</button>
        </div>
      </aside>
      <main className="contenido">
        <Routes>
          <Route path="/" element={<Inicio />} />
          <Route path="/presupuesto" element={<Presupuesto />} />
          <Route path="/reportes" element={<Reportes />} />
          {contab && <Route path="/ajustes" element={<Ajustes />} />}
          {contab && <Route path="/carga-real" element={<CargaReal />} />}
          {contab && <Route path="/mapeos" element={<Mapeos />} />}
          {esRol(perfil, 'admin') && <Route path="/usuarios" element={<Usuarios />} />}
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  )
}
