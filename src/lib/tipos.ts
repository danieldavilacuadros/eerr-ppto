export type Rol = 'admin' | 'contabilidad' | 'jefe' | 'lectura'
export type Esquema = 'E1' | 'E2'
export type Empresa = 'INCAMOTORS' | 'NOVA_AUTOS'

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
export interface Linea { codigo: string; nombre: string; empresa: Empresa }
export interface Centro { sede: string; unidad: string; linea: string; activo: boolean }

export interface Cuenta {
  cuenta: string
  nombre: string
  clase: string
  es_estadistica: boolean
  activa: boolean
  rubro: string | null
}

export interface RubroEERR { codigo: string; orden: number }

/** Fila de un reporte (Excel "ESQUEMA 1" / "ESQUEMA 2"). */
export interface FilaEsquema {
  esquema: Esquema
  codigo: string
  orden: number
  etiqueta: string | null
  nivel: number
  tipo: 'grupo' | 'rubro' | 'formula' | 'pct' | 'manual'
  padre: string | null
  rubro: string | null
  formula: string[] | null
  base: string | null
  concepto: string | null
  negrita: boolean
}

export interface MontoEmpresa { escenario_id: number; anio: number; mes: number; concepto: string; monto: number }

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
