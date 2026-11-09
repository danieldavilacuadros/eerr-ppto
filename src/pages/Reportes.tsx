import { useEffect, useMemo, useState } from 'react'
import { cuentasDeVista, esRol, puedeVer, traerVistaCuentas, useDatos, type VistaCuenta } from '../lib/datos'
import { MESES, num, pct } from '../lib/formato'
import { construirEsquema, crearRubroDe, filasVisibles, padresAgrupacion, type Entrada, type FilaEERR } from '../lib/esquema'
import { supabase, traerTodo } from '../lib/supabase'
import { exportarTabla } from '../lib/excel'
import type { Esquema, Monto, MontoEmpresa } from '../lib/tipos'

type Fuente = 'SAP' | 'EXTRA' | 'TODO'
const FUENTES: { codigo: Fuente; nombre: string }[] = [
  { codigo: 'SAP', nombre: 'Solo SAP' },
  { codigo: 'EXTRA', nombre: 'Solo extra libros' },
  { codigo: 'TODO', nombre: 'SAP + extra libros' },
]

/** 'VISTAS' = Esquema 2 con sólo los rubros configurados en Vistas de presupuesto para los filtros elegidos. */
type EsqSel = Esquema | 'VISTAS'
const ESQUEMAS: { codigo: EsqSel; nombre: string; ayuda: string }[] = [
  { codigo: 'E1', nombre: 'Esquema 1', ayuda: 'Ventas, costo, utilidad bruta y gastos por naturaleza hasta el resultado neto.' },
  { codigo: 'E2', nombre: 'Esquema 2', ayuda: 'Utilidad bruta de cada línea de negocio y luego los gastos hasta el resultado neto.' },
  { codigo: 'VISTAS', nombre: 'Según vistas', ayuda: 'Esquema 2 sólo con los rubros y cuentas configurados en Vistas de presupuesto para los filtros elegidos (y los que tengan montos).' },
]

export default function Reportes() {
  const { perfil, accesos, cat } = useDatos()
  const escs = cat?.escenarios ?? []
  const [aId, setAId] = useState<number | undefined>(
    () => (escs.find(e => e.codigo === 'REAL_2026') ?? escs.find(e => e.tipo === 'real') ?? escs[0])?.id)
  const a = escs.find(e => e.id === aId)
  const [esqSel, setEsqSel] = useState<EsqSel>(() => {
    try { return (localStorage.getItem('eerr-esquema') as EsqSel) || 'E1' } catch { return 'E1' }
  })
  const segunVistas = esqSel === 'VISTAS'
  const esquema: Esquema = segunVistas ? 'E2' : esqSel as Esquema
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
  const [fuente, setFuente] = useState<Fuente>('SAP')
  const [datos, setDatos] = useState<(Monto & { fuente: string })[] | null>(null)
  const [empresaMontos, setEmpresaMontos] = useState<MontoEmpresa[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { try { localStorage.setItem('eerr-esquema', esqSel) } catch { /* sin almacenamiento */ } }, [esqSel])

  useEffect(() => {
    if (!a) return
    setDatos(null)
    setError(null)
    traerTodo<Monto & { fuente: string }>((d, h) => supabase.rpc('resumen_montos_fuente', { p_escenarios: [a.id] }).range(d, h))
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
  // real: SAP (directo) y extra libros (ajustes de contabilidad) por separado; el presupuesto no tiene fuente
  const esReal = a?.tipo === 'real'
  const fuenteOk = (f: string) => !esReal || fuente === 'TODO' || f === fuente
  const filtrados = useMemo(() => (datos ?? []).filter(r =>
    fuenteOk(r.fuente) && r.mes <= nMeses && (!sede || r.sede === sede) && (!unidad || r.unidad === unidad) && (!linea || r.linea === linea) &&
    unidadesLc.has(r.unidad) && (!empresa || (empresaDe.get(r.linea) ?? 'INCAMOTORS') === empresa)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [datos, nMeses, sede, unidad, linea, unidadesLc, empresa, empresaDe, fuente, esReal])

  // participaciones e impuesto a la renta: sólo en el total de la empresa (sin filtros); en el real son ajustes de
  // contabilidad, así que se ven sólo cuando la fuente incluye extra libros
  const totalEmpresa = !lc && !sede && !unidad && !linea && !empresa
  const conEmpresa = totalEmpresa && (!esReal || fuente !== 'SAP')
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
    if (conEmpresa) {
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
  [cat, a, datos, filtrados, nMeses, esquema, conCuentas, conEmpresa, empresaMontos, moneda])

  const volumen = useMemo(() => {
    const v = new Array(nMeses + 1).fill(0) as number[]
    for (const r of filtrados) if (cuentas.get(r.cuenta)?.es_estadistica) { v[r.mes - 1] += Number(r.monto); v[nMeses] += Number(r.monto) }
    return v
  }, [filtrados, cuentas, nMeses])

  // ---- "Según vistas": rubros y cuentas configurados en las vistas que cumplen los filtros
  // Sin filtro de sede o marca basta la lista de cada unidad (sale del real de todas sus vistas); con sede o marca se
  // aplican las excepciones de esas vistas, que se traen filtradas (son muchas).
  const [excRep, setExcRep] = useState<VistaCuenta[] | null>([])
  const porSedeLinea = !!(sede || linea)
  useEffect(() => {
    if (!segunVistas || !porSedeLinea) { setExcRep([]); return }
    let vivo = true
    setExcRep(null)
    traerVistaCuentas({ unidad: unidad || undefined, sede: sede || undefined, linea: linea || undefined })
      .then(x => { if (vivo) setExcRep(x) })
    return () => { vivo = false }
  }, [segunVistas, porSedeLinea, unidad, sede, linea])

  const cfgVistas = useMemo(() => {
    if (!segunVistas || !cat || excRep == null) return null
    const vistas = visibles.filter(c => c.activo && (!sede || c.sede === sede) && (!unidad || c.unidad === unidad) &&
      (!linea || c.linea === linea) && unidadesLc.has(c.unidad) && (!empresa || (empresaDe.get(c.linea) ?? 'INCAMOTORS') === empresa))
    const rubros = new Set<string>()
    const ctas = new Set<string>()
    const agregar = (cta: string, u: string) => { ctas.add(cta); const r = rubroDe(cta, u); if (r) rubros.add(r) }
    if (!porSedeLinea) {
      for (const u of new Set(vistas.map(v => v.unidad))) {
        const lista = cat.unidadCuentas.filter(x => x.unidad === u)
        if (!lista.length) return null   // unidad sin lista: no se oculta nada
        lista.forEach(x => agregar(x.cuenta, u))
      }
    } else {
      for (const v of vistas) {
        const s = cuentasDeVista(cat.unidadCuentas, excRep, v)
        if (!s) return null
        s.forEach(cta => agregar(cta, v.unidad))
      }
    }
    return { rubros, ctas }
  }, [segunVistas, cat, excRep, visibles, sede, unidad, linea, unidadesLc, empresa, empresaDe, rubroDe, porSedeLinea])

  // filas ocultas: rubros y cuentas sin configuración ni montos, y grupos que se quedan sin rubros visibles
  const ocultasVista = useMemo(() => {
    const ocultas = new Set<string>()
    if (!cfgVistas || !rep) return ocultas
    const conMonto = (f: FilaEERR) => f.valores.some(v => Math.abs(v) > 0.5)
    const padres = padresAgrupacion(rep.filas)
    const conVisible = new Set<number>()
    rep.filas.forEach((f, i) => {
      const oculta = (f.tipo === 'rubro' && !cfgVistas.rubros.has(f.rubro ?? '') && !conMonto(f)) ||
        (f.tipo === 'cuenta' && !cfgVistas.ctas.has(f.cuenta ?? '') && !conMonto(f))
      if (oculta) { ocultas.add(f.clave); return }
      if (f.tipo === 'rubro') for (let p = padres[i]; p != null; p = padres[p]) conVisible.add(p)
    })
    rep.filas.forEach((f, i) => { if (f.tipo === 'grupo' && !conVisible.has(i)) ocultas.add(f.clave) })
    return ocultas
  }, [cfgVistas, rep])

  if (!cat) return null
  const columnas = [...MESES.slice(0, nMeses).map(m => `${m} ${a?.anio ?? ''}`), `Total ${MESES[0]}–${MESES[nMeses - 1]}`]
  const maxNivel = Math.max(0, ...(rep?.filas.map(f => f.nivel) ?? [0]))
  const vis = rep ? filasVisibles(rep.filas, plegados).filter(x => !ocultasVista.has(x.fila.clave)) : []
  const alternar = (f: FilaEERR) =>
    setPlegados(p => { const s = new Set(p); if (s.has(f.clave)) s.delete(f.clave); else s.add(f.clave); return s })
  // botones 1, 2, 3…: cierran las filas que agrupan a filas de mayor nivel que el elegido
  const verNivel = (n: number) => {
    setNivelMax(n)
    if (!rep) return
    const padres = padresAgrupacion(rep.filas)
    setPlegados(new Set(rep.filas.flatMap((f, i) => (f.nivel > n && padres[i] != null ? [rep.filas[padres[i]!].clave] : []))))
  }
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
    const titulo = `${a?.nombre}${esReal ? ` (${FUENTES.find(f => f.codigo === fuente)?.nombre})` : ''} · ${ESQUEMAS.find(e => e.codigo === esqSel)?.nombre} · ${moneda === 'PEN' ? 'Soles' : 'Dólares'}`
    const filtro = [lc && cat!.lineasComerciales.find(x => x.codigo === lc)?.nombre, sede && cat!.sedes.find(x => x.codigo === sede)?.nombre,
      unidad && cat!.unidades.find(x => x.codigo === unidad)?.nombre, linea && cat!.lineas.find(x => x.codigo === linea)?.nombre,
      empresa === 'NOVA_AUTOS' ? 'Nova Autos' : empresa ? 'Incamotors' : ''].filter(Boolean).join(' · ') || 'Toda la empresa'
    const cab = ['Rubro', ...columnas.flatMap(c => (conPct ? [c, '%'] : [c]))]
    const aoa: (string | number | null)[][] = [[titulo], [filtro], [], cab]
    const niveles = [0, 0, 0, 0]
    for (const f of rep.filas) {
      if (ocultasVista.has(f.clave)) continue
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
    exportarTabla(aoa, `EERR_${esqSel}_${a?.codigo}.xlsx`, segunVistas ? 'SEGUN VISTAS' : esquema === 'E1' ? 'ESQUEMA 1' : 'ESQUEMA 2', niveles, formatos)
  }

  return (
    <div>
      <div className="encabezado">
        <div>
          <h1>Estados de resultados</h1>
          <p className="sub">{ESQUEMAS.find(e => e.codigo === esqSel)?.ayuda} · {moneda === 'PEN' ? 'Soles' : 'Dólares'}{miles ? ' (miles)' : ''}</p>
        </div>
        <div className="segmentado">
          {ESQUEMAS.map(e => <button key={e.codigo} className={esqSel === e.codigo ? 'activo' : ''} onClick={() => { setEsqSel(e.codigo); setPlegados(new Set()); setNivelMax(99) }}>{e.nombre}</button>)}
        </div>
      </div>

      <div className="tarjeta filtros-reporte">
        <label>Escenario
          <select value={aId} onChange={e => { setAId(Number(e.target.value)); setHasta(null) }}>
            {escs.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </label>
        {esReal && (
          <label>Fuente
            <select value={fuente} onChange={e => setFuente(e.target.value as Fuente)}>
              {FUENTES.map(f => <option key={f.codigo} value={f.codigo}>{f.nombre}</option>)}
            </select>
          </label>
        )}
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
            {segunVistas && excRep == null && <span className="chip">Cargando la configuración de las vistas…</span>}
            {segunVistas && excRep != null && !cfgVistas && <span className="chip">Alguna unidad no tiene lista de cuentas: se muestran todos los rubros</span>}
            {esReal && <span className={`chip ${fuente === 'SAP' ? 'azul' : ''}`}>{fuente === 'SAP' ? 'Real directo de SAP (sin extra libros)'
              : fuente === 'EXTRA' ? 'Sólo extra libros y ajustes de contabilidad' : 'SAP + extra libros (cuadra con contabilidad)'}</span>}
            {conManuales && !totalEmpresa && <span className="chip">Participaciones e impuesto a la renta: sólo en el total de la empresa</span>}
            {conManuales && totalEmpresa && esReal && fuente === 'SAP' && <span className="chip">Participaciones e impuesto a la renta: se ven con extra libros</span>}
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
                  const cerrado = plegados.has(f.clave)
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
