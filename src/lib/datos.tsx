import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, traerTodo } from './supabase'
import type {
  Acceso, Centro, Cuenta, Escenario, FilaEsquema, Linea, LineaComercial, Perfil, RubroEERR, Sede, TipoCambio, Unidad,
} from './tipos'

export interface Excepcion { cuenta: string; unidad: string; rubro: string }
/** Cuenta de la lista de una unidad de negocio (se presupuesta en todas sus vistas). */
export interface UnidadCuenta { unidad: string; cuenta: string }
/** Excepción de una vista (centro): agrega (incluir = true) o quita (false) una cuenta de la lista de su unidad. */
export interface VistaCuenta { sede: string; unidad: string; linea: string; cuenta: string; incluir: boolean }

export interface Catalogos {
  sedes: Sede[]
  lineasComerciales: LineaComercial[]
  unidades: Unidad[]
  lineas: Linea[]
  centros: Centro[]
  cuentas: Cuenta[]
  rubros: RubroEERR[]
  excepciones: Excepcion[]
  esquemas: FilaEsquema[]
  escenarios: Escenario[]
  tipoCambio: TipoCambio[]
  unidadCuentas: UnidadCuenta[]
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

/** Tabla que puede no existir todavía (migración pendiente): devuelve [] en vez de fallar. */
async function tablaOpcional<T>(nombre: string): Promise<T[]> {
  try { return await tabla<T>(nombre) } catch { return [] }
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
      const [p, a, sedes, lineasComerciales, unidades, lineas, centros, cuentas, rubros, excepciones, esquemas, escenarios, tipoCambio,
        unidadCuentas] =
        await Promise.all([
          supabase.from('perfiles').select('*').eq('id', uid).maybeSingle(),
          supabase.from('accesos').select('*').eq('perfil_id', uid),
          tabla<Sede>('sedes', 'orden'),
          tabla<LineaComercial>('lineas_comerciales', 'orden'),
          tabla<Unidad>('unidades_negocio', 'orden'),
          tabla<Linea>('lineas', 'nombre'),
          tabla<Centro>('centros'),
          tabla<Cuenta>('cuentas', 'cuenta'),
          tabla<RubroEERR>('rubros_eerr', 'orden'),
          tabla<Excepcion>('mapa_excepciones'),
          tabla<FilaEsquema>('esquema_filas', 'orden'),
          tabla<Escenario>('escenarios', 'anio'),
          tabla<TipoCambio>('tipo_cambio'),
          tablaOpcional<UnidadCuenta>('unidad_cuentas'),
        ])
      if (p.error) throw new Error(p.error.message)
      setPerfil(p.data as Perfil | null)
      setAccesos((a.data ?? []) as Acceso[])
      setCat({ sedes, lineasComerciales, unidades, lineas, centros, cuentas, rubros, excepciones, esquemas, escenarios, tipoCambio,
        unidadCuentas })
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

/**
 * Excepciones por vista (son decenas de miles: no van en el catálogo). Se traen sólo las de una unidad o una vista.
 * Devuelve [] si la tabla aún no existe.
 */
export async function traerVistaCuentas(f: { unidad?: string; unidades?: string[]; sede?: string; linea?: string }): Promise<VistaCuenta[]> {
  try {
    return await traerTodo<VistaCuenta>((d, h) => {
      let q = supabase.from('vista_cuentas').select('sede,unidad,linea,cuenta,incluir')
      if (f.unidad) q = q.eq('unidad', f.unidad)
      if (f.unidades) q = q.in('unidad', f.unidades)
      if (f.sede) q = q.eq('sede', f.sede)
      if (f.linea) q = q.eq('linea', f.linea)
      return q.order('sede').order('linea').order('cuenta').range(d, h) as unknown as
        PromiseLike<{ data: VistaCuenta[] | null; error: { message: string } | null }>
    })
  } catch { return [] }
}

/**
 * Cuentas que se presupuestan en una vista (centro): lista de su unidad + agregadas en la vista − quitadas en la vista.
 * Devuelve null si la unidad no tiene lista (entonces se usan todas las cuentas del mapa).
 */
export function cuentasDeVista(
  unidadCuentas: UnidadCuenta[], vistaCuentas: VistaCuenta[], c: { sede: string; unidad: string; linea: string },
): Set<string> | null {
  const lista = unidadCuentas.filter(x => x.unidad === c.unidad)
  const exc = vistaCuentas.filter(x => x.sede === c.sede && x.unidad === c.unidad && x.linea === c.linea)
  if (!lista.length && !exc.some(x => x.incluir)) return null
  const s = new Set(lista.map(x => x.cuenta))
  for (const x of exc) { if (x.incluir) s.add(x.cuenta); else s.delete(x.cuenta) }
  return s
}

export { signoCuenta } from './reparto'
