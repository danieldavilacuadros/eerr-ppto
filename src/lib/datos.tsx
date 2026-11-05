import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, traerTodo } from './supabase'
import type {
  Acceso, Centro, Cuenta, Escenario, Linea, LineaComercial, Mapeo, Perfil, Rubro, Sede, TipoCambio, Unidad, Vista,
} from './tipos'

export interface Catalogos {
  sedes: Sede[]
  lineasComerciales: LineaComercial[]
  unidades: Unidad[]
  lineas: Linea[]
  centros: Centro[]
  cuentas: Cuenta[]
  rubros: Rubro[]
  mapeos: Mapeo[]
  escenarios: Escenario[]
  tipoCambio: TipoCambio[]
}

interface Ctx {
  session: Session | null
  cargando: boolean
  error: string | null
  perfil: Perfil | null
  accesos: Acceso[]
  cat: Catalogos | null
  recargar: () => Promise<void>
}

const DatosCtx = createContext<Ctx>(null as unknown as Ctx)
export const useDatos = () => useContext(DatosCtx)

async function tabla<T>(nombre: string, orden?: string): Promise<T[]> {
  return traerTodo<T>((d, h) => {
    let q = supabase.from(nombre).select('*')
    if (orden) q = q.order(orden)
    return q.range(d, h) as unknown as PromiseLike<{ data: T[] | null; error: { message: string } | null }>
  })
}

export function DatosProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [accesos, setAccesos] = useState<Acceso[]>([])
  const [cat, setCat] = useState<Catalogos | null>(null)

  const cargar = useCallback(async (s: Session | null) => {
    if (!s) { setPerfil(null); setAccesos([]); setCat(null); setCargando(false); return }
    setCargando(true)
    setError(null)
    try {
      const uid = s.user.id
      const [p, a, sedes, lineasComerciales, unidades, lineas, centros, cuentas, rubros, mapeos, escenarios, tipoCambio] =
        await Promise.all([
          supabase.from('perfiles').select('*').eq('id', uid).maybeSingle(),
          supabase.from('accesos').select('*').eq('perfil_id', uid),
          tabla<Sede>('sedes', 'orden'),
          tabla<LineaComercial>('lineas_comerciales', 'orden'),
          tabla<Unidad>('unidades_negocio', 'orden'),
          tabla<Linea>('lineas', 'nombre'),
          tabla<Centro>('centros'),
          tabla<Cuenta>('cuentas', 'cuenta'),
          tabla<Rubro>('rubros', 'orden'),
          tabla<Mapeo>('mapeo_cuentas'),
          tabla<Escenario>('escenarios', 'anio'),
          tabla<TipoCambio>('tipo_cambio'),
        ])
      if (p.error) throw new Error(p.error.message)
      setPerfil(p.data as Perfil | null)
      setAccesos((a.data ?? []) as Acceso[])
      setCat({ sedes, lineasComerciales, unidades, lineas, centros, cuentas, rubros, mapeos, escenarios, tipoCambio })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); cargar(data.session) })
    const { data: sub } = supabase.auth.onAuthStateChange((evento, s) => {
      setSession(s)
      if (evento === 'SIGNED_IN' || evento === 'SIGNED_OUT') cargar(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [cargar])

  const valor = useMemo<Ctx>(() => ({
    session, cargando, error, perfil, accesos, cat, recargar: () => cargar(session),
  }), [session, cargando, error, perfil, accesos, cat, cargar])

  return <DatosCtx.Provider value={valor}>{children}</DatosCtx.Provider>
}

// ---------------------------------------------------------------- permisos (espejo de las funciones SQL)
const coincide = (a: Acceso, sede: string, unidad: string, linea: string, cuenta?: string) =>
  (a.sede == null || a.sede === sede) &&
  (a.unidad == null || a.unidad === unidad) &&
  (a.linea == null || a.linea === linea) &&
  (a.cuenta_prefijo == null || cuenta == null || cuenta.startsWith(a.cuenta_prefijo))

export function puedeVer(perfil: Perfil | null, accesos: Acceso[], c: { sede: string; unidad: string; linea: string }, cuenta?: string) {
  if (!perfil?.activo) return false
  if (perfil.rol === 'admin' || perfil.rol === 'contabilidad') return true
  return accesos.some(a => coincide(a, c.sede, c.unidad, c.linea, cuenta))
}

export function puedeEditar(
  perfil: Perfil | null, accesos: Acceso[], esc: Escenario | undefined,
  c: { sede: string; unidad: string; linea: string }, cuenta?: string,
) {
  if (!perfil?.activo || !esc || esc.tipo !== 'ppto' || esc.estado !== 'abierto') return false
  if (perfil.rol === 'admin') return true
  if (perfil.rol !== 'jefe' && perfil.rol !== 'contabilidad') return false
  return accesos.some(a => a.puede_editar && coincide(a, c.sede, c.unidad, c.linea, cuenta))
}

export const esRol = (perfil: Perfil | null, ...roles: string[]) => !!perfil?.activo && roles.includes(perfil.rol)

// ---------------------------------------------------------------- utilidades de catálogo
export function nombreDe<T extends { codigo: string; nombre: string }>(lista: T[] | undefined, codigo: string) {
  return lista?.find(x => x.codigo === codigo)?.nombre ?? codigo
}

/** Devuelve el rubro de una cuenta en la vista indicada (con excepción por unidad si existe). */
export function crearResolverRubro(mapeos: Mapeo[], vista: Vista) {
  const porDefecto = new Map<string, string>()
  const porUnidad = new Map<string, string>()
  for (const m of mapeos) {
    if (m.vista !== vista) continue
    if (m.unidad) porUnidad.set(`${m.cuenta}|${m.unidad}`, m.rubro)
    else porDefecto.set(m.cuenta, m.rubro)
  }
  return (cuenta: string, unidad: string): string | null =>
    porUnidad.get(`${cuenta}|${unidad}`) ?? porDefecto.get(cuenta) ?? null
}

/** Signo con el que se presenta una cuenta: ingresos (+), gastos (−). */
export const signoCuenta = (c: Cuenta | undefined) => (c?.clase === '6' ? -1 : 1)
