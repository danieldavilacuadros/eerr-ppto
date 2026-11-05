export type Rol = 'admin' | 'contabilidad' | 'jefe' | 'lectura'
export type Vista = 'contable' | 'comercial'

export interface Perfil {
  id: string
  email: string
  nombre: string | null
  cargo: string | null
  rol: Rol
  activo: boolean
}

export interface Acceso {
  id: number
  perfil_id: string
  sede: string | null
  unidad: string | null
  linea: string | null
  cuenta_prefijo: string | null
  puede_editar: boolean
}

export interface Sede { codigo: string; nombre: string; orden: number }
export interface LineaComercial { codigo: string; nombre: string; orden: number }
export interface Unidad { codigo: string; nombre: string; linea_comercial: string; orden: number }
export interface Linea { codigo: string; nombre: string }
export interface Centro { sede: string; unidad: string; linea: string; activo: boolean }

export interface Cuenta {
  cuenta: string
  nombre: string
  clase: string
  es_estadistica: boolean
  activa: boolean
}

export interface Rubro {
  vista: Vista
  codigo: string
  nombre: string
  tipo: 'seccion' | 'detalle' | 'total'
  padre: string | null
  formula: string[] | null
  orden: number
}

export interface Mapeo {
  id: number
  vista: Vista
  cuenta: string
  unidad: string | null
  rubro: string
}

export interface Escenario {
  id: number
  codigo: string
  nombre: string
  anio: number
  tipo: 'real' | 'ppto'
  estado: 'abierto' | 'cerrado'
}

export interface TipoCambio { anio: number; mes: number; tc: number }

export interface Monto {
  escenario_id: number
  anio: number
  mes: number
  sede: string
  unidad: string
  linea: string
  cuenta: string
  monto: number
}
