import { memo, useRef, useState } from 'react'
import { num, parseNumero } from '../lib/formato'

/** Celda numérica editable tipo Excel: Enter/flechas para moverse, Esc cancela, pega bloques copiados de Excel. */
export const Celda = memo(function Celda({ valor, editable, fila, col, onFijar, onPegar, total }: {
  valor: number; editable: boolean; fila: number; col: number; total?: boolean
  onFijar: (fila: number, col: number, n: number) => void
  onPegar: (fila: number, col: number, texto: string) => void
}) {
  const [txt, setTxt] = useState<string | null>(null)
  const cancelado = useRef(false)
  const recienEnfocado = useRef(false)
  const mover = (f: number, c: number) => {
    const el = document.querySelector<HTMLInputElement>(`input[data-f="${f}"][data-c="${c}"]`)
    el?.focus()
  }
  if (!editable) return <span className={`n celda-ro${total ? ' b' : ''}`}>{num(valor)}</span>
  return (
    <input
      className={`celda${total ? ' total' : ''}`}
      data-f={fila} data-c={col}
      value={txt ?? num(valor).replace('–', '')}
      onFocus={e => {
        cancelado.current = false
        recienEnfocado.current = true
        const t = e.target
        t.value = valor ? String(Math.round(valor * 100) / 100) : ''
        t.select()
        setTxt(t.value)
      }}
      // el clic que da el foco no debe quitar la selección: lo escrito reemplaza el valor
      onMouseUp={e => { if (recienEnfocado.current) { e.preventDefault(); recienEnfocado.current = false } }}
      onChange={e => { recienEnfocado.current = false; setTxt(e.target.value) }}
      onBlur={() => {
        if (txt != null && !cancelado.current) {
          const n = parseNumero(txt)
          if (n != null && Math.abs(n - valor) > 0.004) onFijar(fila, col, n)
        }
        setTxt(null)
      }}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); mover(fila + 1, col) }
        else if (e.key === 'ArrowUp') { e.preventDefault(); mover(fila - 1, col) }
        else if (e.key === 'Escape') { cancelado.current = true; (e.target as HTMLInputElement).blur() }
      }}
      onPaste={e => {
        const t = e.clipboardData.getData('text')
        if (t.includes('\t') || t.trim().includes('\n')) { e.preventDefault(); setTxt(null); onPegar(fila, col, t) }
      }}
    />
  )
})
