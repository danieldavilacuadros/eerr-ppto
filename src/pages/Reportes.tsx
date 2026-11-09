import { useEffect, useMemo, useState } from 'react'
import { esRol, puedeVer, useDatos } from '../lib/datos'
import { MESES, num, pct } from '../lib/formato'
import { construirEsquema, crearRubroDe, filasVisibles, type Entrada, type FilaEERR } from '../lib/esquema'
import { supabase, traerTodo } from '../lib/supabase'
import { exportarTabla } from '../lib/excel'
import type { Esquema, Monto, MontoEmpresa } from '../lib/tipos'

const ESQUEMAS: { codigo: Esquema; nombre: string; ayuda: string }[] = [
  { codigo: 'E1', nombre: 'Esquema 1', ayuda: 'Ventas, costo, utilidad bruta y gastos por naturaleza hasta el resultado neto.' },
  { codigo: 'E2', nombre: 'Esquema 2', ayuda: 'Utilidad bruta de cada línea de negocio y luego los gastos hasta el resultado neto.' },
]

export default function Reportes() {
  const { perfil, accesos, cat } = useDatos()
  const escs = cat?.escenarios ?? []
  const [aId, setAId] = useState<number | undefined>(
    () => (escs.find(e => e.codigo === 'REAL_2026') ?? escs.find(e => e.tipo === 'real') ?? escs[0])?.id)
  const a = escs.find(e => e.id === aId)
  const [esquema, setEsquema] = useState<Esquema>(() => (localStorage.getItem('eerr-esquema') as Esquema) || 'E1')
  const [hasta, setHasta] = useState<number | null>(null)
  const [moneda, setMoneda] = useState<'PEN' | 'USD'>('PEN')
  const [lc, setLc] = useState('')
  const [sede, setSede] = useState('')
  const [unidad, setUnidad] = useState('')
  const [linea, setLinea] = useState('')
  const [empresa, setEmpresa] = useState('')
  const [miles, setMiles] = useState(false)
  const [conPct, setConPct] = useState(true)
  const [conCuentas, setConCuentas] = useState(false)
  const [nivelMax, setNivelMax] = useState(99)
  const [plegados, setPlegados] = useState<Set<string>>(new Set())
  const [datos, setDatos] = useState<Monto[] | null>(null)
  const [empresaMontos, setEmpresaMontos] = useState<MontoEmpresa[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { try { localStorage.setItem('eerr-esquema', esquema) } catch { /* sin almacenamiento */ } }, [esquema])

  useEffect(() => {
    if (!a) return
    setDatos(null)
    setError(null)
    traerTodo<Monto>((d, h) => supabase.rpc('resumen_montos', { p_escenarios: [a.id] }).range(d, h))
      .then(setDatos).catch(e => setError(e.message))
    // participaciones e impuesto a la renta (sólo admin y contabilidad pueden leerlos)
    supabase.from('montos_empresa').select('*').eq('escenario_id', a.id)
      .then(({ data }) => setEmpresaMontos((data ?? []) as MontoEmpresa[]))
  }, [a])

  const cuentas = useMemo(() => new Map((cat?.cuentas ?? []).map(c => [c.cuenta, c])), [cat])
  const rubroDe = useMemo(() => crearRubroDe(cuentas, cat?.excepciones ?? []), [cuentas, cat])
  const empresaDe = useMemo(() => new Map((cat?.lineas ?? []).map(l => [l.codigo, l.empresa])), [cat])
  const tcDe = useMemo(() => {
    const m = new Map((cat?.tipoCambio ?? []).map(t => [t.anio * 100 + t.mes, Number(t.tc)]))
    const claves = [...m.keys()].sort()
    return (anio: number, mes: number) => {
      const k = anio * 100 + mes
      if (m.has(k)) return m.get(k)!
      const prev = claves.filter(x => x <= k).at(-1) ?? claves[0]
      return prev ? m.get(prev)! : 3.75
    }
  }, [cat])

  // último mes con datos: el reporte muestra de enero a ese mes (se puede cambiar)
  const ultimoMes = useMemo(() => (datos ?? []).reduce((m, r) => (Number(r.monto) ? Math.max(m, r.mes) : m), 0) || 12, [datos])
  const nMeses = hasta ?? ultimoMes

  const visibles = useMemo(() => (cat?.centros ?? []).filter(c => puedeVer(perfil, accesos, c)), [cat, perfil, accesos])
  const unidadesLc = useMemo(() => new Set((cat?.unidades ?? []).filter(u => !lc || u.linea_comercial === lc).map(u => u.codigo)), [cat, lc])
  const filtrados = useMemo(() => (datos ?? []).filter(r =>
    r.mes <= nMeses && (!sede || r.sede === sede) && (!unidad || r.unidad === unidad) && (!linea || r.linea === linea) &&
    unidadesLc.has(r.unidad) && (!empresa || (empresaDe.get(r.linea) ?? 'INCAMOTORS') === empresa)),
  [datos, nMeses, sede, unidad, linea, unidadesLc, empresa, empresaDe])

  // participaciones e impuesto a la renta: sólo en el total de la empresa (sin filtros)
  const totalEmpresa = !lc && !sede && !unidad && !linea && !empresa
  const conv = (monto: number, anio: number, mes: number) => monto / (moneda === 'USD' ? tcDe(anio, mes) : 1)

  const rep = useMemo(() => {
    if (!cat || !a || !datos) return null
    const n = nMeses + 1
    const ent = new Map<string, Entrada>()
    for (const r of filtrados) {
      const k = `${r.cuenta}|${r.unidad}`
      if (!ent.has(k)) ent.set(k, { cuenta: r.cuenta, unidad: r.unidad, valores: new Array(n).fill(0) })
      const v = conv(Number(r.monto), r.anio, r.mes)
      const e = ent.get(k)!
      e.valores[r.mes - 1] += v
      e.valores[n - 1] += v
    }
    let manual: Map<string, number[]> | null = null
    if (totalEmpresa) {
      manual = new Map()
      for (const m of empresaMontos) {
        if (m.mes > nMeses) continue
        if (!manual.has(m.concepto)) manual.set(m.concepto, new Array(n).fill(0))
        const v = conv(Number(m.monto), m.anio, m.mes)
        manual.get(m.concepto)![m.mes - 1] += v
        manual.get(m.concepto)![n - 1] += v
      }
    }
    return construirEsquema({ filas: cat.esquemas, esquema, cuentas, rubroDe, entradas: [...ent.values()], columnas: n, conCuentas, manual })
  }, // eslint-disable-next-line react-hooks/exhaustive-deps
  [cat, a, datos, filtrados, nMeses, esquema, conCuentas, totalEmpresa, empresaMontos, moneda])

  const volumen = useMemo(() => {
    const v = new Array(nMeses + 1).fill(0) as number[]
    for (const r of filtrados) if (cuentas.get(r.cuenta)?.es_estadistica) { v[r.mes - 1] += Number(r.monto); v[nMeses] += Number(r.monto) }
    return v
  }, [filtrados, cuentas, nMeses])

  if (!cat) return null
  const columnas = [...MESES.slice(0, nMeses).map(m => `${m} ${a?.anio ?? ''}`), `Total ${MESES[0]}–${MESES[nMeses - 1]}`]
  const maxNivel = Math.max(0, ...(rep?.filas.map(f => f.nivel) ?? [0]))
  const vis = rep ? filasVisibles(rep.filas, plegados, nivelMax) : []
  const alternar = (f: FilaEERR) => {
    if (f.nivel >= nivelMax) {
      // fila agrupada por el botón de nivel: se abre sólo ésta y las demás de ese nivel quedan agrupadas
      const otras = (rep?.filas ?? []).filter((x, i, arr) => x.clave !== f.clave && x.nivel >= nivelMax && (arr[i + 1]?.nivel ?? -1) > x.nivel)
      setPlegados(new Set(otras.map(x => x.clave)))
      setNivelMax(99)
      return
    }
    setPlegados(p => { const s = new Set(p); if (s.has(f.clave)) s.delete(f.clave); else s.add(f.clave); return s })
  }
  const verNivel = (n: number) => { setNivelMax(n); setPlegados(new Set()) }
  const conManuales = cat.esquemas.some(f => f.esquema === esquema && f.tipo === 'manual')
  const puedeVerEmpresa = esRol(perfil, 'admin', 'contabilidad')

  const celdas = (f: FilaEERR) => f.valores.flatMap((x, i) => {
    const v = f.tipo === 'pct' ? pct(x) : num(x, miles)
    if (!conPct) return [v]
    const b = f.base?.[i]
    return [v, f.tipo !== 'pct' && b ? pct(x / Math.abs(b)) : '']
  })

  function exportar() {
    if (!rep) return
    const titulo = `${a?.nombre} · ${ESQUEMAS.find(e => e.codigo === esquema)?.nombre} · ${moneda === 'PEN' ? 'Soles' : 'Dólares'}`
    const filtro = [lc && cat!.lineasComerciales.find(x => x.codigo === lc)?.nombre, sede && cat!.sedes.find(x => x.codigo === sede)?.nombre,
      unidad && cat!.unidades.find(x => x.codigo === unidad)?.nombre, linea && cat!.lineas.find(x => x.codigo === linea)?.nombre,
      empresa === 'NOVA_AUTOS' ? 'Nova Autos' : empresa ? 'Incamotors' : ''].filter(Boolean).join(' · ') || 'Toda la empresa'
    const cab = ['Rubro', ...columnas.flatMap(c => (conPct ? [c, '%'] : [c]))]
    const aoa: (string | number | null)[][] = [[titulo], [filtro], [], cab]
    const niveles = [0, 0, 0, 0]
    for (const f of rep.filas) {
      const vals = f.valores.flatMap((x, i) => {
        const v = isFinite(x) ? (f.tipo === 'pct' ? Math.round(x * 10000) / 10000 : Math.round(x * 100) / 100) : null
        if (!conPct) return [v]
        const b = f.base?.[i]
        return [v, f.tipo !== 'pct' && b ? Math.round((x / Math.abs(b)) * 10000) / 10000 : null]
      })
      aoa.push([`${'   '.repeat(f.nivel)}${f.cuenta ? `${f.cuenta} ` : ''}${f.etiqueta}`, ...vals])
      niveles.push(Math.min(f.nivel, 7))
    }
    const formatos = [null, ...columnas.flatMap(() => (conPct ? ['#,##0;(#,##0)', '0.0%'] : ['#,##0;(#,##0)']))]
    exportarTabla(aoa, `EERR_${esquema}_${a?.codigo}.xlsx`, esquema === 'E1' ? 'ESQUEMA 1' : 'ESQUEMA 2', niveles, formatos)
  }

  return (
    <div>
      <div className="encabezado">
        <div>
          <h1>Estados de resultados</h1>
          <p className="sub">{ESQUEMAS.find(e => e.codigo === esquema)?.ayuda} · {moneda === 'PEN' ? 'Soles' : 'Dólares'}{miles ? ' (miles)' : ''}</p>
        </div>
        <div className="segmentado">
          {ESQUEMAS.map(e => <button key={e.codigo} className={esquema === e.codigo ? 'activo' : ''} onClick={() => { setEsquema(e.codigo); setPlegados(new Set()) }}>{e.nombre}</button>)}
        </div>
      </div>

      <div className="tarjeta filtros-reporte">
        <label>Escenario
          <select value={aId} onChange={e => { setAId(Number(e.target.value)); setHasta(null) }}>
            {escs.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </label>
        <label>Hasta el mes
          <select value={nMeses} onChange={e => setHasta(Number(e.target.value))}>
            {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </label>
        <label>Línea de negocio
          <select value={lc} onChange={e => { setLc(e.target.value); setUnidad('') }}>
            <option value="">Todas</option>
            {cat.lineasComerciales.map(l => <option key={l.codigo} value={l.codigo}>{l.nombre}</option>)}
          </select>
        </label>
        <label>Unidad
          <select value={unidad} onChange={e => setUnidad(e.target.value)}>
            <option value="">Todas</option>
            {cat.unidades.filter(u => unidadesLc.has(u.codigo) && visibles.some(c => c.unidad === u.codigo))
              .map(u => <option key={u.codigo} value={u.codigo}>{u.nombre}</option>)}
          </select>
        </label>
        <label>Sede
          <select value={sede} onChange={e => setSede(e.target.value)}>
            <option value="">Todas</option>
            {cat.sedes.filter(s => visibles.some(c => c.sede === s.codigo)).map(s => <option key={s.codigo} value={s.codigo}>{s.nombre}</option>)}
          </select>
        </label>
        <label>Marca
          <select value={linea} onChange={e => setLinea(e.target.value)}>
            <option value="">Todas</option>
            {cat.lineas.filter(l => visibles.some(c => c.linea === l.codigo && (!unidad || c.unidad === unidad) && (!sede || c.sede === sede))
              && (!empresa || l.empresa === empresa))
              .map(l => <option key={l.codigo} value={l.codigo}>{l.nombre}</option>)}
          </select>
        </label>
        <label>Empresa
          <select value={empresa} onChange={e => { setEmpresa(e.target.value); setLinea('') }}>
            <option value="">Todas</option>
            <option value="INCAMOTORS">Incamotors</option>
            <option value="NOVA_AUTOS">Nova Autos (Chevrolet, Isuzu)</option>
          </select>
        </label>
        <label>Moneda
          <select value={moneda} onChange={e => setMoneda(e.target.value as 'PEN' | 'USD')}>
            <option value="PEN">Soles (S/)</option>
            <option value="USD">Dólares (US$)</option>
          </select>
        </label>
        <label className="check"><input type="checkbox" checked={miles} onChange={e => setMiles(e.target.checked)} /> En miles</label>
        <label className="check"><input type="checkbox" checked={conPct} onChange={e => setConPct(e.target.checked)} /> Columnas %</label>
        <label className="check"><input type="checkbox" checked={conCuentas} onChange={e => setConCuentas(e.target.checked)} /> Ver cuentas mayores</label>
        <button onClick={exportar} disabled={!rep}>Exportar a Excel</button>
      </div>

      {error && <div className="alerta error">{error}</div>}
      {!datos ? <div className="tarjeta">Cargando…</div> : rep && (
        <div className="tarjeta">
          <div className="barra">
            <span className="ayuda">Agrupar por nivel:</span>
            <div className="segmentado">
              {Array.from({ length: maxNivel + 1 }, (_, i) => (
                <button key={i} className={nivelMax === i ? 'activo' : ''} onClick={() => verNivel(i)}>{i + 1}</button>
              ))}
              <button className={nivelMax === 99 ? 'activo' : ''} onClick={() => verNivel(99)}>Todo</button>
            </div>
            {rep.sinRubro.some(x => Math.abs(x) > 0.5) && <span className="chip error">Hay cuentas sin rubro: no suman (ver al final)</span>}
            {conManuales && !totalEmpresa && <span className="chip">Participaciones e impuesto a la renta: sólo en el total de la empresa</span>}
            {conManuales && totalEmpresa && !puedeVerEmpresa && <span className="chip">Participaciones e impuesto a la renta: visibles para contabilidad</span>}
          </div>
          <div className="scroll grilla-cont">
            <table className="tabla reporte esquema">
              <thead>
                <tr>
                  <th className="fija">Rubro</th>
                  {columnas.map((c, i) => [<th key={`v${i}`} className={`n${i === nMeses ? ' col-total' : ''}`}>{c}</th>,
                    conPct && <th key={`p${i}`} className="n pct">%</th>])}
                </tr>
              </thead>
              <tbody>
                {volumen.some(Boolean) && (
                  <tr className="fila-vol">
                    <td className="fija">Volumen (unidades / litros)</td>
                    {volumen.flatMap((x, i) => [<td key={`v${i}`} className="n">{num(x)}</td>, conPct && <td key={`p${i}`} />])}
                  </tr>
                )}
                {vis.map(({ fila: f, tieneHijos }) => {
                  const cerrado = plegados.has(f.clave) || f.nivel >= nivelMax
                  return (
                    <tr key={f.clave} className={`fila-e fila-${f.tipo} n${f.nivel}${f.negrita ? ' b' : ''}${tieneHijos ? ' plegable' : ''}`}
                      onClick={tieneHijos ? () => alternar(f) : undefined}
                      title={tieneHijos ? (cerrado ? 'Clic para desplegar' : 'Clic para agrupar') : undefined}>
                      <td className="fija" style={{ paddingLeft: 8 + f.nivel * 16 }}>
                        <span className="flecha">{tieneHijos ? (cerrado ? '▸' : '▾') : ''}</span>
                        {f.cuenta && <span className="cod">{f.cuenta}</span>} {f.tipo === 'pct' ? '%' : f.etiqueta}
                      </td>
                      {celdas(f).map((x, i) => (
                        <td key={i} className={`n${conPct && i % 2 === 1 ? ' pct' : ''}${Math.floor(i / (conPct ? 2 : 1)) === nMeses ? ' col-total' : ''}`}>{x}</td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
