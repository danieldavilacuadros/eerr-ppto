import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [clave, setClave] = useState('')
  const [modo, setModo] = useState<'clave' | 'enlace'>('clave')
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function entrar(e: FormEvent) {
    e.preventDefault()
    setEnviando(true)
    setMsg(null)
    if (modo === 'clave') {
      const { error } = await supabase.auth.signInWithPassword({ email, password: clave })
      if (error) setMsg({ tipo: 'error', texto: 'Correo o contraseña incorrectos.' })
    } else {
      const { error } = await supabase.auth.signInWithOtp({
        email, options: { shouldCreateUser: false, emailRedirectTo: window.location.href.split('#')[0] },
      })
      setMsg(error
        ? { tipo: 'error', texto: 'No se pudo enviar el enlace. ¿El usuario fue creado por el administrador?' }
        : { tipo: 'ok', texto: 'Revise su correo: le enviamos un enlace para ingresar.' })
    }
    setEnviando(false)
  }

  return (
    <div className="centrado login-fondo">
      <form className="tarjeta login" onSubmit={entrar}>
        <div className="marca grande">
          <span className="logo">IM</span>
          <div>
            <strong>Incamotors</strong>
            <small>Estados de resultados y presupuesto</small>
          </div>
        </div>
        <label>Correo corporativo
          <input type="email" required value={email} onChange={e => setEmail(e.target.value)} autoFocus />
        </label>
        {modo === 'clave' && (
          <label>Contraseña
            <input type="password" required value={clave} onChange={e => setClave(e.target.value)} />
          </label>
        )}
        {msg && <div className={`alerta ${msg.tipo}`}>{msg.texto}</div>}
        <button className="primario" disabled={enviando}>{modo === 'clave' ? 'Ingresar' : 'Enviarme un enlace'}</button>
        <button type="button" className="link" onClick={() => { setModo(modo === 'clave' ? 'enlace' : 'clave'); setMsg(null) }}>
          {modo === 'clave' ? 'Ingresar con un enlace por correo (sin contraseña)' : 'Ingresar con contraseña'}
        </button>
      </form>
    </div>
  )
}
