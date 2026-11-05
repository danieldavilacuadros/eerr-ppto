import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const configurado = Boolean(url && key)

export const supabase = createClient(url || 'http://localhost', key || 'sin-clave', {
  auth: { persistSession: true, autoRefreshToken: true },
  // fetch resuelto en cada llamada (permite interceptar en pruebas locales)
  global: { fetch: (...args: Parameters<typeof fetch>) => fetch(...args) },
})

const PAGINA = 1000

/** Supabase devuelve máximo 1000 filas por consulta: este helper pagina hasta traer todo. */
export async function traerTodo<T>(
  consulta: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const todo: T[] = []
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await consulta(desde, desde + PAGINA - 1)
    if (error) throw new Error(error.message)
    todo.push(...(data ?? []))
    if (!data || data.length < PAGINA) break
  }
  return todo
}

/** Inserta/actualiza en lotes para no exceder límites de payload. */
export async function upsertEnLotes<T extends object>(
  tabla: string,
  filas: T[],
  opciones: { onConflict?: string } = {},
  alAvanzar?: (hechas: number) => void,
) {
  const LOTE = 500
  for (let i = 0; i < filas.length; i += LOTE) {
    const { error } = await supabase.from(tabla).upsert(filas.slice(i, i + LOTE), opciones)
    if (error) throw new Error(error.message)
    alAvanzar?.(Math.min(i + LOTE, filas.length))
  }
}
