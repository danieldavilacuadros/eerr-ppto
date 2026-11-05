import { useDatos } from '../lib/datos'

export interface CentroSel { sede: string; unidad: string; linea: string }

/** Tres selects encadenados sede → unidad → línea, limitados a centros existentes. */
export default function SelectorCentro({ valor, onCambio }: { valor: CentroSel; onCambio: (c: CentroSel) => void }) {
  const { cat } = useDatos()
  if (!cat) return null
  const centros = cat.centros.filter(c => c.activo)
  return (
    <>
      <select value={valor.sede} onChange={e => onCambio({ sede: e.target.value, unidad: '', linea: '' })}>
        <option value="">Sede…</option>
        {cat.sedes.map(s => <option key={s.codigo} value={s.codigo}>{s.nombre}</option>)}
      </select>
      <select value={valor.unidad} onChange={e => onCambio({ ...valor, unidad: e.target.value, linea: '' })}>
        <option value="">Unidad…</option>
        {cat.unidades.filter(u => centros.some(c => c.sede === valor.sede && c.unidad === u.codigo))
          .map(u => <option key={u.codigo} value={u.codigo}>{u.nombre}</option>)}
      </select>
      <select value={valor.linea} onChange={e => onCambio({ ...valor, linea: e.target.value })}>
        <option value="">Línea…</option>
        {cat.lineas.filter(l => centros.some(c => c.sede === valor.sede && c.unidad === valor.unidad && c.linea === l.codigo))
          .map(l => <option key={l.codigo} value={l.codigo}>{l.nombre}</option>)}
      </select>
    </>
  )
}
