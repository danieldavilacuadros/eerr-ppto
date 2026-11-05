import { useEffect, useMemo, useState } from 'react'
import { crearResolverRubro, puedeVer, useDatos } from '../lib/datos'
import { MESES, MESES_LARGOS, num, pct, suma } from '../lib/formato'
import { construirReporte, type Entrada } from '../lib/reporte'
import { supabase, traerTodo } from '../lib/supabase'
import { exportarTabla } from '../lib/excel'
import type { Monto, Vista } from '../lib/tipos'

type Modo = 'mensual' | 'mes' | 'acumulado' | 'anio'

export default function Reportes() {
  const { perfil, accesos, cat } = useDatos()
  const escs = cat?.escenarios ?? []
  const defA = escs.find(e => e.tipo === 'ppto' && e.estado === 'abierto') ?? escs[0]
  const [aId, setAId] = useState<number | undefined>(defA?.id)
  const a = escs.find(e => e.id === aId)
  const [bId, setBId] = useState<number | ''>(
    () => escs.find(e => e.tipo === 'real' && defA && e.anio === defA.anio - 1)?.id ?? '')
  const b = escs.find(e => e.id === bId)
  const [vista, setVista] = useState<Vista>('comercial')
  const [modo, setModo] = useState<Modo>('mensual')
  const [mes, setMes] = useState(new Date().getMonth() + 1)
  const [moneda, setMoneda] = useState<'PEN' | 'USD'>('PEN')
  const [lc, setLc] = useState('')
  const [sede, setSede] = useState('')
  const [unidad, setUnidad] = useState('')
  const [linea, setLinea] = useState('')
  const [verCuentas, setVerCuentas] = useState(false)
  const [miles, setMiles] = useState(false)
  // secciones / rubros plegados (se recuerda en este navegador)
  const [plegados, setPlegados] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('eerr-plegados') ?? '[]') as string[]) } catch { return new Set() }
  })
  useEffect(() => {
    try { localStorage.setItem('eerr-plegados', JSON.stringify([...plegados])) } catch { /* sin almacenamiento */ }
  }, [plegados])
  const alternar = (clave: string) => setPlegados(p => {
    const n = new Set(p)
    if (n.has(clave)) n.delete(clave); else n.add(clave)
    return n
  })
  const [datos, setDatos] = useState<Monto[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!a) return
    setDatos(null)
    const ids = [a.id, ...(b ? [b.id] : [])]
    traerTodo<Monto>((d, h) => supabase.rpc('resumen_montos', { p_escenarios: ids }).range(d, h))
      .then(setDatos).catch(e => setError(e.message))
  }, [a, b])

  const cuentas = useMemo(() => new Map((cat?.cuentas ?? []).map(c => [c.cuenta, c])), [cat])
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

  const visibles = useMemo(() => (cat?.centros ?? []).filter(c => puedeVer(perfil, accesos, c)), [cat, perfil, accesos])
  const unidadesLc = new Set((cat?.unidades ?? []).filter(u => !lc || u.linea_comercial === lc).map(u => u.codigo))

  const filtrados = useMemo(() => (datos ?? []).filter(r =>
    (!sede || r.sede === sede) && (!unidad || r.unidad === unidad) && (!linea || r.linea === linea) && unidadesLc.has(r.unidad)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [datos, sede, unidad, linea, lc, cat])

  const columnas = modo === 'mensual'
    ? [...MESES.map(m => `${m} ${a?.anio ?? ''}`), `Total ${a?.nombre ?? ''}`]
    : [a?.nombre ?? 'A', b?.nombre ?? '—', 'Variación', 'Var %']

  const armar = (v: Vista) => {
    if (!cat || !a) return null
    const n = modo === 'mensual' ? 12 : 2
    const ent = new Map<string, Entrada>()
    for (const r of filtrados) {
      const enA = r.escenario_id === a.id
      if (modo !== 'mensual') {
        if (modo === 'mes' && r.mes !== mes) continue
        if (modo === 'acumulado' && r.mes > mes) continue
      } else if (!enA) continue
      const k = `${r.cuenta}|${r.unidad}`
      if (!ent.has(k)) ent.set(k, { cuenta: r.cuenta, unidad: r.unidad, valores: new Array(n).fill(0) })
      const val = Number(r.monto) / (moneda === 'USD' ? tcDe(r.anio, r.mes) : 1)
      const col = modo === 'mensual' ? r.mes - 1 : enA ? 0 : 1
      ent.get(k)!.valores[col] += val
    }
    return construirReporte({
      rubros: cat.rubros, vista: v, resolver: crearResolverRubro(cat.mapeos, v), cuentas,
      entradas: [...ent.values()], columnas: n, conCuentas: verCuentas,
    })
  }
  const rep = useMemo(() => armar(vista), // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtrados, vista, modo, mes, moneda, verCuentas, a, b])
  const repOtra = useMemo(() => armar(vista === 'contable' ? 'comercial' : 'contable'), // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtrados, vista, modo, mes, moneda, a, b])

  const volumen = useMemo(() => {
    const v = { a: new Array(12).fill(0) as number[], b: new Array(12).fill(0) as number[] }
    for (const r of filtrados) if (cuentas.get(r.cuenta)?.es_estadistica) (r.escenario_id === a?.id ? v.a : v.b)[r.mes - 1] += Number(r.monto)
    return v
  }, [filtrados, cuentas, a])

  if (!cat) return null

  const valoresFila = (vals: number[]): number[] => {
    if (modo === 'mensual') return [...vals, suma(vals)]
    const [x, y] = vals
    return [x, y, x - y, y ? (x - y) / Math.abs(y) : NaN]
  }
  const ultimoTotal = (r: ReturnType<typeof armar>) => r?.filas.filter(f => f.tipo === 'total').at(-1)
  const totA = ultimoTotal(rep), totB = ultimoTotal(repOtra)
  const sumaT = (t?: { valores: number[] }) => (t ? suma(modo === 'mensual' ? t.valores : t.valores.slice(0, 1)) : 0)
  const cuadra = totA && totB && Math.abs(sumaT(totA) - sumaT(totB)) < 1

  function exportar() {
    if (!rep) return
    const titulo = `${a?.nombre}${modo !== 'mensual' && b ? ` vs ${b.nombre}` : ''} · vista ${vista} · ${moneda}`
    const aoa: (string | number | null)[][] = [[titulo], [], ['Rubro / cuenta', ...columnas]]
    for (const f of rep.filas) {
      const v = valoresFila(f.valores)
      aoa.push([(f.tipo === 'cuenta' ? `   ${f.cuenta} ` : f.tipo === 'detalle' ? '  ' : '') + f.nombre,
        ...v.map((x, i) => (modo !== 'mensual' && i === 3 ? (isFinite(x) ? Math.round(x * 1000) / 1000 : null) : Math.round(x * 100) / 100))])
    }
    exportarTabla(aoa, `EERR_${vista}_${a?.codigo}.xlsx`)
  }

  const fmt = (x: number, i: number) => (modo !== 'mensual' && i === 3 ? pct(x) : num(x, miles))

  // agrupación: cada fila de detalle/cuenta cuelga de su sección; cada cuenta, de su rubro de detalle
  let seccionActual = '', detalleActual = ''
  const filasVista = (rep?.filas ?? []).map(f => {
    if (f.tipo === 'seccion') { seccionActual = f.clave; detalleActual = '' }
    else if (f.tipo === 'total') { seccionActual = ''; detalleActual = '' }
    else if (f.tipo === 'detalle' || f.tipo === 'sin') detalleActual = f.clave
    const padres = f.tipo === 'detalle' ? [seccionActual] : f.tipo === 'cuenta' ? [seccionActual, detalleActual] : []
    return { f, padres: padres.filter(Boolean) }
  })
  const conHijos = new Set(filasVista.flatMap(x => x.padres))
  const plegables = [...conHijos].filter(c => rep?.filas.some(f => f.clave === c && f.tipo === 'seccion'))

  return (
    <div>
      <div className="encabezado">
        <div>
          <h1>Estados de resultados</h1>
          <p className="sub">Real y presupuesto según su alcance · {moneda === 'PEN' ? 'Soles' : 'Dólares'}{miles ? ' (miles)' : ''}</p>
        </div>
        <div className="segmentado">
          <button className={vista === 'comercial' ? 'activo' : ''} onClick={() => setVista('comercial')}>Vista comercial</button>
          <button className={vista === 'contable' ? 'activo' : ''} onClick={() => setVista('contable')}>Vista contable</button>
        </div>
      </div>

      <div className="tarjeta filtros-reporte">
        <label>Escenario
          <select value={aId} onChange={e => setAId(Number(e.target.value))}>
            {escs.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </label>
        <label>Comparar con
          <select value={bId} onChange={e => setBId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">— Ninguno —</option>
            {escs.filter(e => e.id !== aId).map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </label>
        <label>Período
          <select value={modo} onChange={e => setModo(e.target.value as Modo)}>
            <option value="mensual">Mes a mes (12 meses)</option>
            <option value="mes">Un mes vs comparativo</option>
            <option value="acumulado">Acumulado a un mes</option>
            <option value="anio">Año completo</option>
          </select>
        </label>
        {(modo === 'mes' || modo === 'acumulado') && (
          <label>Mes
            <select value={mes} onChange={e => setMes(Number(e.target.value))}>
              {MESES_LARGOS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </label>
        )}
        <label>Línea comercial
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
        <label>Línea / marca
          <select value={linea} onChange={e => setLinea(e.target.value)}>
            <option value="">Todas</option>
            {cat.lineas.filter(l => visibles.some(c => c.linea === l.codigo && (!unidad || c.unidad === unidad) && (!sede || c.sede === sede)))
              .map(l => <option key={l.codigo} value={l.codigo}>{l.nombre}</option>)}
          </select>
        </label>
        <label>Moneda
          <select value={moneda} onChange={e => setMoneda(e.target.value as 'PEN' | 'USD')}>
            <option value="PEN">Soles (S/)</option>
            <option value="USD">Dólares (US$)</option>
          </select>
        </label>
        <label className="check"><input type="checkbox" checked={verCuentas} onChange={e => setVerCuentas(e.target.checked)} /> Ver cuentas mayores</label>
        <label className="check"><input type="checkbox" checked={miles} onChange={e => setMiles(e.target.checked)} /> En miles</label>
        <button onClick={exportar} disabled={!rep}>Exportar a Excel</button>
      </div>

      {error && <div className="alerta error">{error}</div>}
      {!datos ? <div className="tarjeta">Cargando…</div> : !rep ? null : (
        <div className="tarjeta">
          <div className="barra">
            {cuadra
              ? <span className="chip ok">✓ Cuadra con la vista {vista === 'contable' ? 'comercial' : 'contable'}</span>
              : <span className="chip error">✗ No cuadra con la vista {vista === 'contable' ? 'comercial' : 'contable'}: revisar mapeo de cuentas</span>}
            {rep.sinClasificar.some(x => Math.abs(x) > 0.5) && <span className="chip error">Hay cuentas sin clasificar</span>}
            <span className="agrupar">
              <button className="chico" onClick={() => setPlegados(new Set(plegables))}>Agrupar todo</button>
              <button className="chico" onClick={() => setPlegados(new Set())}>Expandir todo</button>
            </span>
          </div>
          <div className="scroll">
            <table className="tabla reporte">
              <thead>
                <tr><th className="fija">Rubro</th>{columnas.map(c => <th key={c} className="n">{c}</th>)}</tr>
              </thead>
              <tbody>
                {(volumen.a.some(Boolean) || volumen.b.some(Boolean)) && (
                  <tr className="fila-vol">
                    <td className="fija">Volumen (unidades / litros)</td>
                    {valoresFila(modo === 'mensual' ? volumen.a
                      : modo === 'anio' ? [suma(volumen.a), suma(volumen.b)]
                        : modo === 'mes' ? [volumen.a[mes - 1], volumen.b[mes - 1]]
                          : [suma(volumen.a.slice(0, mes)), suma(volumen.b.slice(0, mes))])
                      .map((x, i) => <td key={i} className="n">{modo !== 'mensual' && i === 3 ? pct(x) : num(x)}</td>)}
                  </tr>
                )}
                {filasVista.filter(({ padres }) => !padres.some(p => plegados.has(p))).map(({ f }) => {
                  const plegable = conHijos.has(f.clave)
                  const cerrado = plegados.has(f.clave)
                  return (
                  <tr key={f.clave} className={`fila-${f.tipo}${plegable ? ' plegable' : ''}`}
                    onClick={plegable ? () => alternar(f.clave) : undefined} title={plegable ? (cerrado ? 'Clic para desplegar' : 'Clic para agrupar') : undefined}>
                    <td className="fija">
                      {plegable ? <span className="flecha">{cerrado ? '▸' : '▾'}</span> : (f.tipo === 'seccion' || f.tipo === 'total') && <span className="flecha" />}
                      {f.tipo === 'cuenta' && <span className="cod">{f.cuenta}</span>} {f.nombre}
                    </td>
                    {valoresFila(f.valores).map((x, i) => (
                      <td key={i} className={`n${modo !== 'mensual' && i >= 2 ? (x < 0 ? ' neg' : x > 0 ? ' pos' : '') : ''}`}>{fmt(x, i)}</td>
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
