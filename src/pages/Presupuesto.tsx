import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Celda } from '../components/Celda'
import { nombreDe, puedeEditar, puedeVer, signoCuenta, useDatos } from '../lib/datos'
import { MESES, ceros, num, parseNumero, pct, suma } from '../lib/formato'
import { construirEsquema, crearRubroDe, filasVisibles, type FilaEERR } from '../lib/esquema'
import { estacionalidad, r2, repartirRubro, signoRubro } from '../lib/reparto'
import { supabase, traerTodo, upsertEnLotes } from '../lib/supabase'
import { exportarPlantilla, leerPlantilla, type FilaPlantilla } from '../lib/excel'
import type { Centro, Escenario, Esquema, Monto } from '../lib/tipos'

type Sel = { sede: string; unidad: string; linea: string }
type Valores = Map<string, number[]>

const claveCentro = (c: Sel) => `${c.sede}|${c.unidad}|${c.linea}`

async function montosCentro(tabla: 'ppto_montos' | 'real_montos', escId: number, c: Sel) {
  return traerTodo<Monto>((d, h) =>
    supabase.from(tabla).select('escenario_id,anio,mes,sede,unidad,linea,cuenta,monto')
      .eq('escenario_id', escId).eq('sede', c.sede).eq('unidad', c.unidad).eq('linea', c.linea).range(d, h))
}

async function resumen(escIds: number[]) {
  return traerTodo<Monto>((d, h) =>
    supabase.rpc('resumen_montos', { p_escenarios: escIds, p_incluir_ajustes: false }).range(d, h))
}

export default function Presupuesto() {
  const { perfil, accesos, cat } = useDatos()
  const pptos = useMemo(() => cat?.escenarios.filter(e => e.tipo === 'ppto') ?? [], [cat])
  const [escId, setEscId] = useState<number | undefined>(
    () => (pptos.find(e => e.estado === 'abierto') ?? pptos[0])?.id)
  const esc = pptos.find(e => e.id === escId)
  const escRef = cat?.escenarios.find(e => e.tipo === 'real' && esc && e.anio === esc.anio - 1)

  const visibles = useMemo(
    () => (cat?.centros ?? []).filter(c => c.activo && puedeVer(perfil, accesos, c)), [cat, perfil, accesos])
  const [sede, setSede] = useState('')
  const [unidad, setUnidad] = useState('')
  const [linea, setLinea] = useState('')
  const [hayCambios, setHayCambios] = useState(false)

  if (!cat || !perfil) return null
  if (!esc) return <div className="alerta">No hay escenarios de presupuesto creados.</div>

  const opcSedes = cat.sedes.filter(s => visibles.some(c => c.sede === s.codigo))
  const opcUnidades = cat.unidades.filter(u => visibles.some(c => c.unidad === u.codigo && (!sede || c.sede === sede)))
  const opcLineas = cat.lineas.filter(l => visibles.some(c => c.linea === l.codigo && (!sede || c.sede === sede) && (!unidad || c.unidad === unidad)))
  const centro = sede && unidad && linea && visibles.some(c => c.sede === sede && c.unidad === unidad && c.linea === linea)
    ? { sede, unidad, linea } : null

  const confirmarSalida = () => !hayCambios || confirm('Tiene cambios sin guardar. ¿Descartarlos?')
  const elegir = (c: Sel) => { if (!confirmarSalida()) return; setSede(c.sede); setUnidad(c.unidad); setLinea(c.linea) }

  return (
    <div>
      <div className="encabezado">
        <div>
          <h1>Carga de presupuesto</h1>
          <p className="sub">
            {esc.nombre} · {esc.estado === 'abierto' ? <span className="chip ok">Abierto para edición</span> : <span className="chip">Cerrado</span>}
          </p>
        </div>
        <div className="filtros">
          <label>Escenario
            <select value={escId} onChange={e => confirmarSalida() && setEscId(Number(e.target.value))}>
              {pptos.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </select>
          </label>
          <label>Sede
            <select value={sede} onChange={e => { if (confirmarSalida()) { setSede(e.target.value); setLinea('') } }}>
              <option value="">— Todas —</option>
              {opcSedes.map(s => <option key={s.codigo} value={s.codigo}>{s.nombre}</option>)}
            </select>
          </label>
          <label>Unidad de negocio
            <select value={unidad} onChange={e => { if (confirmarSalida()) { setUnidad(e.target.value); setLinea('') } }}>
              <option value="">— Todas —</option>
              {opcUnidades.map(u => <option key={u.codigo} value={u.codigo}>{u.nombre}</option>)}
            </select>
          </label>
          <label>Línea / marca
            <select value={linea} onChange={e => confirmarSalida() && setLinea(e.target.value)}>
              <option value="">— Elegir —</option>
              {opcLineas.map(l => <option key={l.codigo} value={l.codigo}>{l.nombre}</option>)}
            </select>
          </label>
        </div>
      </div>

      {centro ? (
        <Grilla key={`${esc.id}|${claveCentro(centro)}`} esc={esc} escRef={escRef} centro={centro}
          onCambios={setHayCambios} onVolver={() => confirmarSalida() && (setLinea(''), setHayCambios(false))} />
      ) : (
        <ResumenCentros esc={esc} escRef={escRef} centros={visibles.filter(c => (!sede || c.sede === sede) && (!unidad || c.unidad === unidad))}
          onElegir={elegir} />
      )}
    </div>
  )
}

// =============================================================================== resumen de centros
function ResumenCentros({ esc, escRef, centros, onElegir }: {
  esc: Escenario; escRef?: Escenario; centros: Centro[]; onElegir: (c: Sel) => void
}) {
  const { perfil, accesos, cat } = useDatos()
  const [datos, setDatos] = useState<Monto[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [importar, setImportar] = useState(false)
  const [exportando, setExportando] = useState(false)

  const cargar = useCallback(() => {
    setDatos(null)
    resumen([esc.id, ...(escRef ? [escRef.id] : [])]).then(setDatos).catch(e => setError(e.message))
  }, [esc.id, escRef])
  useEffect(cargar, [cargar])

  const cuentas = useMemo(() => new Map(cat!.cuentas.map(c => [c.cuenta, c])), [cat])
  const tot = useMemo(() => {
    const m = new Map<string, { ing: number; gas: number; ref: number; filas: number }>()
    for (const r of datos ?? []) {
      const c = cuentas.get(r.cuenta)
      if (c?.es_estadistica) continue
      const k = claveCentro(r)
      if (!m.has(k)) m.set(k, { ing: 0, gas: 0, ref: 0, filas: 0 })
      const t = m.get(k)!
      if (r.escenario_id === esc.id) {
        if (r.monto >= 0) t.ing += Number(r.monto); else t.gas += Number(r.monto)
        t.filas++
      } else t.ref += Number(r.monto)
    }
    return m
  }, [datos, cuentas, esc.id])

  const editables = centros.filter(c => puedeEditar(perfil, accesos, esc, c))

  async function descargarTodo() {
    setExportando(true)
    try {
      const filas = await armarPlantillaMultiple(editables, datos ?? [], esc, escRef, cat!)
      exportarPlantilla(filas, `PPTO_${esc.anio}_mis_centros.xlsx`, `${esc.nombre} — ${perfil?.nombre ?? ''}`)
    } finally { setExportando(false) }
  }

  if (error) return <div className="alerta error">{error}</div>
  const lista = [...centros].sort((a, b) =>
    a.sede.localeCompare(b.sede) || a.unidad.localeCompare(b.unidad) || a.linea.localeCompare(b.linea))
  const totalRes = lista.reduce((s, c) => { const t = tot.get(claveCentro(c)); return s + (t ? t.ing + t.gas : 0) }, 0)

  return (
    <div className="tarjeta">
      <div className="barra">
        <h3>Centros de resultado ({lista.length})</h3>
        <span className="sub">Elija un centro para cargar su presupuesto, o trabaje todos juntos en Excel.</span>
        <div className="espacio" />
        {editables.length > 0 && <>
          <button onClick={descargarTodo} disabled={!datos || exportando}>{exportando ? 'Generando…' : 'Descargar Excel (mis centros)'}</button>
          <button className="primario" onClick={() => setImportar(true)}>Cargar Excel</button>
        </>}
      </div>
      {importar && <ImportarExcel esc={esc} onCerrar={() => setImportar(false)} onCargado={cargar} />}
      {!datos ? <p>Cargando…</p> : (
        <div className="scroll">
          <table className="tabla simple">
            <thead>
              <tr>
                <th>Sede</th><th>Unidad</th><th>Línea / marca</th>
                <th className="n">Ingresos ppto</th><th className="n">Costos y gastos ppto</th><th className="n">Resultado ppto</th>
                {escRef && <th className="n">Resultado {escRef.nombre}</th>}
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {lista.map(c => {
                const t = tot.get(claveCentro(c))
                const ed = puedeEditar(perfil, accesos, esc, c)
                return (
                  <tr key={claveCentro(c)} className="clic" onClick={() => onElegir(c)}>
                    <td>{nombreDe(cat!.sedes, c.sede)}</td>
                    <td>{nombreDe(cat!.unidades, c.unidad)}</td>
                    <td>{nombreDe(cat!.lineas, c.linea)}</td>
                    <td className="n">{num(t?.ing)}</td>
                    <td className="n">{num(t?.gas)}</td>
                    <td className="n b">{num(t ? t.ing + t.gas : 0)}</td>
                    {escRef && <td className="n">{num(t?.ref)}</td>}
                    <td>{t?.filas ? <span className="chip ok">Con datos</span> : <span className="chip">Vacío</span>}
                      {ed && <span className="chip azul">Editable</span>}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr><td colSpan={5}>Total</td><td className="n b">{num(totalRes)}</td>{escRef && <td />}<td /></tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}

async function armarPlantillaMultiple(
  centros: Centro[], datos: Monto[], esc: Escenario, escRef: Escenario | undefined,
  cat: NonNullable<ReturnType<typeof useDatos>['cat']>,
): Promise<FilaPlantilla[]> {
  const cuentas = new Map(cat.cuentas.map(c => [c.cuenta, c]))
  const rubroDe = crearRubroDe(cuentas, cat.excepciones)
  const porCentro = new Map<string, Map<string, number[]>>()
  const refPorUnidad = new Map<string, Set<string>>()
  for (const r of datos) {
    if (escRef && r.escenario_id === escRef.id) {
      if (!refPorUnidad.has(r.unidad)) refPorUnidad.set(r.unidad, new Set())
      refPorUnidad.get(r.unidad)!.add(r.cuenta)
    }
    const k = claveCentro(r)
    if (!porCentro.has(k)) porCentro.set(k, new Map())
    const m = porCentro.get(k)!
    if (!m.has(r.cuenta)) m.set(r.cuenta, ceros())
    if (r.escenario_id === esc.id) m.get(r.cuenta)![r.mes - 1] += Number(r.monto) * signoCuenta(cuentas.get(r.cuenta))
  }
  const filas: FilaPlantilla[] = []
  for (const c of centros) {
    const m = porCentro.get(claveCentro(c)) ?? new Map<string, number[]>()
    // si el centro no tiene datos, sugerimos las cuentas usadas por su unidad de negocio el año anterior
    let lista = [...m.keys()]
    if (!lista.length) lista = [...(refPorUnidad.get(c.unidad) ?? [])]
    if (!lista.length) lista = cat.cuentas.filter(x => x.activa).map(x => x.cuenta)
    for (const cta of lista.sort()) {
      filas.push({
        sede: c.sede, unidad: c.unidad, linea: c.linea, cuenta: cta, nombre: cuentas.get(cta)?.nombre ?? '',
        rubro: cuentas.get(cta)?.es_estadistica ? 'ESTADÍSTICA' : rubroDe(cta, c.unidad) ?? 'SIN RUBRO',
        valores: m.get(cta) ?? ceros(),
      })
    }
  }
  return filas
}

// =============================================================================== importación Excel
function ImportarExcel({ esc, onCerrar, onCargado }: { esc: Escenario; onCerrar: () => void; onCargado: () => void }) {
  const { perfil, accesos, cat } = useDatos()
  const [estado, setEstado] = useState<{ filas: Monto[]; errores: string[]; centros: number; lineas: number } | null>(null)
  const [progreso, setProgreso] = useState<string | null>(null)
  const [fin, setFin] = useState<string | null>(null)

  async function leer(f: File) {
    setFin(null)
    const { filas, errores } = await leerPlantilla(f)
    const cuentas = new Map(cat!.cuentas.map(c => [c.cuenta, c]))
    const centros = new Set(cat!.centros.map(claveCentro))
    const salida: Monto[] = []
    const usados = new Set<string>()
    const vistos = new Set<string>()
    filas.forEach((f, i) => {
      const donde = `${f.sede}/${f.unidad}/${f.linea} cuenta ${f.cuenta}`
      const k = claveCentro(f)
      if (!centros.has(k)) { errores.push(`${donde}: el centro sede/unidad/línea no existe.`); return }
      const c = cuentas.get(f.cuenta)
      if (!c) { errores.push(`${donde}: la cuenta no existe en el maestro.`); return }
      if (!puedeEditar(perfil, accesos, esc, f, f.cuenta)) { errores.push(`${donde}: no tiene permiso para editar.`); return }
      const dup = `${k}|${f.cuenta}`
      if (vistos.has(dup)) { errores.push(`${donde}: fila repetida (fila ${i + 1}), se sumará.`) }
      vistos.add(dup)
      usados.add(k)
      f.valores.forEach((v, m) => salida.push({
        escenario_id: esc.id, anio: esc.anio, mes: m + 1, sede: f.sede, unidad: f.unidad, linea: f.linea,
        cuenta: f.cuenta, monto: Math.round(v * signoCuenta(c) * 100) / 100,
      }))
    })
    // consolidar repetidos
    const agg = new Map<string, Monto>()
    for (const r of salida) {
      const k = `${claveCentro(r)}|${r.cuenta}|${r.mes}`
      if (agg.has(k)) agg.get(k)!.monto += r.monto; else agg.set(k, { ...r })
    }
    setEstado({ filas: [...agg.values()], errores, centros: usados.size, lineas: vistos.size })
  }

  async function cargar() {
    if (!estado) return
    try {
      setProgreso('0')
      await upsertEnLotes('ppto_montos', estado.filas, { onConflict: 'escenario_id,anio,mes,sede,unidad,linea,cuenta' },
        n => setProgreso(`${n} / ${estado.filas.length}`))
      setFin(`Carga completa: ${estado.lineas} cuentas en ${estado.centros} centro(s).`)
      setEstado(null)
      onCargado()
    } catch (e) {
      setFin(`Error al guardar: ${(e as Error).message}`)
    } finally { setProgreso(null) }
  }

  return (
    <div className="panel">
      <div className="barra">
        <h3>Cargar presupuesto desde Excel</h3>
        <div className="espacio" />
        <button className="link" onClick={onCerrar}>Cerrar</button>
      </div>
      <p className="sub">Use la plantilla descargada desde aquí. Los importes van en positivo según la naturaleza de la cuenta;
        las filas del archivo reemplazan los 12 meses de esa cuenta en ese centro.</p>
      <input type="file" accept=".xlsx,.xls" onChange={e => e.target.files?.[0] && leer(e.target.files[0])} />
      {estado && (
        <div style={{ marginTop: 12 }}>
          <p><strong>{estado.lineas}</strong> cuentas válidas en <strong>{estado.centros}</strong> centro(s) ·{' '}
            {estado.errores.length} observación(es).</p>
          {estado.errores.length > 0 && (
            <div className="alerta error lista">
              {estado.errores.slice(0, 50).map((e, i) => <div key={i}>{e}</div>)}
              {estado.errores.length > 50 && <div>… y {estado.errores.length - 50} más</div>}
            </div>
          )}
          <button className="primario" disabled={!estado.filas.length || progreso != null} onClick={cargar}>
            {progreso != null ? `Guardando ${progreso}…` : `Cargar ${estado.lineas} cuentas`}
          </button>
        </div>
      )}
      {fin && <div className={`alerta ${fin.startsWith('Error') ? 'error' : 'ok'}`}>{fin}</div>}
    </div>
  )
}

// =============================================================================== grilla de un centro
type FilaGrilla =
  | { tipo: 'fila'; f: FilaEERR; tieneHijos: boolean }
  | { tipo: 'cuenta'; cuenta: string; nivel: number }

function Grilla({ esc, escRef, centro: centroProp, onCambios, onVolver }: {
  esc: Escenario; escRef?: Escenario; centro: Sel; onCambios: (b: boolean) => void; onVolver: () => void
}) {
  const { perfil, accesos, cat } = useDatos()
  // el padre crea un objeto nuevo en cada render; la grilla se monta por centro (key), así que lo fijamos
  const [centro] = useState(centroProp)
  const [esquema, setEsquema] = useState<Esquema>('E1')
  const [valores, setValores] = useState<Valores | null>(null)
  const [originales, setOriginales] = useState<Valores>(new Map())
  const [ref, setRef] = useState<Valores>(new Map())
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set())
  const [plegados, setPlegados] = useState<Set<string>>(new Set())
  const [soloConDatos, setSoloConDatos] = useState(false)
  const [msg, setMsg] = useState<{ tipo: string; texto: string } | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [importar, setImportar] = useState(false)

  const cuentas = useMemo(() => new Map(cat!.cuentas.map(c => [c.cuenta, c])), [cat])
  const rubroDe = useMemo(() => crearRubroDe(cuentas, cat!.excepciones), [cuentas, cat])
  const editable = puedeEditar(perfil, accesos, esc, centro)
  const puedeCuenta = useCallback((cta: string) => puedeEditar(perfil, accesos, esc, centro, cta), [perfil, accesos, esc, centro])

  const aValores = useCallback((filas: Monto[]) => {
    const m: Valores = new Map()
    for (const r of filas) {
      if (!m.has(r.cuenta)) m.set(r.cuenta, ceros())
      m.get(r.cuenta)![r.mes - 1] += Number(r.monto) * signoCuenta(cuentas.get(r.cuenta))
    }
    return m
  }, [cuentas])

  const cargar = useCallback(async () => {
    setValores(null)
    const [p, r] = await Promise.all([
      montosCentro('ppto_montos', esc.id, centro),
      escRef ? montosCentro('real_montos', escRef.id, centro) : Promise.resolve([] as Monto[]),
    ])
    const v = aValores(p)
    setOriginales(new Map([...v].map(([k, a]) => [k, [...a]])))
    setValores(v)
    setRef(aValores(r))
  }, [esc.id, escRef, centro, aValores])
  useEffect(() => { cargar().catch(e => setMsg({ tipo: 'error', texto: e.message })) }, [cargar])

  // ---- cambios pendientes
  const cambios = useMemo(() => {
    const out: { cuenta: string; mes: number; valor: number }[] = []
    if (!valores) return out
    for (const [cta, arr] of valores) {
      const o = originales.get(cta) ?? ceros()
      arr.forEach((v, i) => { if (Math.abs(v - o[i]) > 0.004) out.push({ cuenta: cta, mes: i + 1, valor: v }) })
    }
    return out
  }, [valores, originales])
  useEffect(() => { onCambios(cambios.length > 0) }, [cambios.length, onCambios])
  useEffect(() => {
    if (!cambios.length) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [cambios.length])

  // ---- cuentas de cada rubro (todas las cuentas del mapa, aunque no tengan datos)
  const cuentasPorRubro = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const c of cat!.cuentas) {
      if (!c.activa || c.es_estadistica) continue
      const r = rubroDe(c.cuenta, centro.unidad)
      if (!r) continue
      if (!m.has(r)) m.set(r, [])
      m.get(r)!.push(c.cuenta)
    }
    return m
  }, [cat, rubroDe, centro.unidad])
  const cuentasPorRubroRef = useRef(cuentasPorRubro)
  cuentasPorRubroRef.current = cuentasPorRubro

  // ---- reporte del centro con la forma del esquema: 12 meses + real del año anterior
  const reporte = useMemo(() => {
    if (!valores) return null
    const entradas = [...new Set([...valores.keys(), ...ref.keys()])].map(cta => {
      const s = signoCuenta(cuentas.get(cta))
      const v = valores.get(cta) ?? ceros()
      return { cuenta: cta, unidad: centro.unidad, valores: [...v.map(x => x * s), suma(ref.get(cta) ?? []) * s] }
    })
    return construirEsquema({ filas: cat!.esquemas, esquema, cuentas, rubroDe, entradas, columnas: 13 })
  }, [valores, ref, cuentas, cat, esquema, rubroDe, centro.unidad])

  const conDatos = (cta: string) =>
    (valores?.get(cta)?.some(v => v !== 0) ?? false) || (ref.get(cta)?.some(v => v !== 0) ?? false) ||
    (originales.get(cta)?.some(v => v !== 0) ?? false)

  // filas en pantalla: participaciones e impuesto a la renta no se presupuestan por centro
  // la agrupación se calcula con todas las filas del esquema (incluidas las de %), que luego no se muestran
  const filasEsq = (reporte?.filas ?? []).filter(f => f.tipo !== 'sin')
  const mostrar = (f: FilaEERR) => f.tipo !== 'pct' && f.tipo !== 'manual' &&
    (!soloConDatos || f.tipo !== 'rubro' || f.valores.some(v => Math.abs(v) > 0.5) ||
      (cuentasPorRubro.get(f.rubro ?? '') ?? []).some(c => conDatos(c) || valores?.get(c)?.some(Boolean)))
  const orden: FilaGrilla[] = []
  for (const { fila: f, tieneHijos } of filasVisibles(filasEsq, plegados).filter(x => mostrar(x.fila))) {
    orden.push({ tipo: 'fila', f, tieneHijos })
    if (f.tipo === 'rubro' && abiertos.has(f.rubro!)) {
      for (const c of cuentasPorRubro.get(f.rubro!) ?? []) orden.push({ tipo: 'cuenta', cuenta: c, nivel: f.nivel + 1 })
    }
  }
  // filas editables en orden de pantalla (navegación con teclado y pegado): 'R:rubro' o 'C:cuenta'
  const volumen = [...cuentas.values()].filter(c => c.es_estadistica)
  const editables: string[] = [...volumen.map(c => `C:${c.cuenta}`)]
  for (const o of orden) {
    if (o.tipo === 'cuenta') editables.push(`C:${o.cuenta}`)
    else if (o.f.tipo === 'rubro') editables.push(`R:${o.f.rubro}`)
  }
  const editablesRef = useRef(editables)
  editablesRef.current = editables
  const refRef = useRef(ref)
  refRef.current = ref

  const ctasEditables = useCallback((rubro: string) => (cuentasPorRubroRef.current.get(rubro) ?? []).filter(puedeCuenta), [puedeCuenta])

  // ---- edición
  const aplicar = useCallback((m: Map<string, number[]>, clave: string, col: number, n: number) => {
    const ref = refRef.current
    if (clave.startsWith('C:')) {
      const cta = clave.slice(2)
      const arr = [...(m.get(cta) ?? ceros())]
      if (col < 12) arr[col] = n
      else estacionalidad(n, ref.get(cta) ?? ceros()).forEach((v, i) => { arr[i] = v })
      m.set(cta, arr)
      return
    }
    const ctas = ctasEditables(clave.slice(2))
    if (col < 12) { repartirRubro(m, ref, ctas, cuentas, col, n); return }
    // total anual del rubro: se reparte por la estacionalidad del rubro en el año anterior
    const base = ceros()
    for (const c of ctas) (ref.get(c) ?? []).forEach((v, i) => { base[i] += Math.abs(v) })
    estacionalidad(n, base).forEach((v, i) => repartirRubro(m, ref, ctas, cuentas, i, v))
  }, [ctasEditables, cuentas])

  const fijar = useCallback((fila: number, col: number, n: number) => {
    const clave = editablesRef.current[fila]
    if (!clave) return
    setValores(prev => { const m = new Map(prev!); aplicar(m, clave, col, n); return m })
  }, [aplicar])

  const pegar = useCallback((fila: number, col: number, texto: string) => {
    const filas = texto.replace(/\r/g, '').split('\n').filter((l, i, a) => l !== '' || i < a.length - 1)
    setValores(prev => {
      const m = new Map(prev!)
      filas.forEach((linea, i) => {
        const clave = editablesRef.current[fila + i]
        if (!clave) return
        linea.split('\t').forEach((t, j) => {
          const n = parseNumero(t)
          if (n != null && col + j < 12) aplicar(m, clave, col + j, n)
        })
      })
      return m
    })
  }, [aplicar])

  async function guardar() {
    if (!cambios.length) return
    setGuardando(true)
    setMsg(null)
    try {
      const filas = cambios.map(c => ({
        escenario_id: esc.id, anio: esc.anio, mes: c.mes, ...centro, cuenta: c.cuenta,
        monto: r2(c.valor * signoCuenta(cuentas.get(c.cuenta))),
      }))
      await upsertEnLotes('ppto_montos', filas, { onConflict: 'escenario_id,anio,mes,sede,unidad,linea,cuenta' })
      setOriginales(new Map([...valores!].map(([k, a]) => [k, [...a]])))
      setMsg({ tipo: 'ok', texto: `Guardado: ${filas.length} celda(s).` })
    } catch (e) {
      setMsg({ tipo: 'error', texto: `No se pudo guardar: ${(e as Error).message}` })
    } finally { setGuardando(false) }
  }

  function copiarReal() {
    if (!escRef) return
    const t = prompt(`Copiar ${escRef.nombre} como base. Variación % a aplicar (ej. 5 o -3):`, '0')
    if (t == null) return
    const p = parseNumero(t)
    if (p == null) return
    setValores(prev => {
      const m = new Map(prev!)
      for (const [cta, arr] of ref) {
        if (!puedeCuenta(cta) || cuentas.get(cta)?.es_estadistica) continue
        m.set(cta, arr.map(v => r2(v * (1 + p / 100))))
      }
      return m
    })
  }

  function descargar() {
    const ctas = [...new Set([...volumen.map(c => c.cuenta), ...[...cuentasPorRubro.values()].flat().filter(c => conDatos(c) || valores?.get(c)?.some(Boolean))])]
    const filas: FilaPlantilla[] = ctas.map(cta => ({
      ...centro, cuenta: cta, nombre: cuentas.get(cta)?.nombre ?? '',
      rubro: cuentas.get(cta)?.es_estadistica ? 'ESTADÍSTICA' : rubroDe(cta, centro.unidad) ?? 'SIN RUBRO',
      valores: valores?.get(cta) ?? ceros(),
    }))
    exportarPlantilla(filas, `PPTO_${esc.anio}_${centro.sede}_${centro.unidad}_${centro.linea}.xlsx`,
      `${esc.nombre} — ${nombreDe(cat!.sedes, centro.sede)} / ${nombreDe(cat!.unidades, centro.unidad)} / ${nombreDe(cat!.lineas, centro.linea)}`)
  }

  if (!valores) return <div className="tarjeta">Cargando presupuesto…{msg && <div className="alerta error">{msg.texto}</div>}</div>

  const totalFinal = reporte?.filas.find(f => f.etiqueta.startsWith('RESULTADO DEL EJERCICIO'))
  const anioRef = escRef?.anio ?? esc.anio - 1
  const todasAbiertas = abiertos.size > 0
  const alternarRubro = (r: string) => setAbiertos(s => { const n = new Set(s); if (n.has(r)) n.delete(r); else n.add(r); return n })
  const alternarGrupo = (k: string) => setPlegados(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const filaCeldas = (clave: string, v: number[], ed: boolean, r: number) => {
    const fila = editables.indexOf(clave)
    return <>
      {v.map((x, i) => <td key={i}><Celda valor={x} editable={ed} fila={fila} col={i} onFijar={fijar} onPegar={pegar} /></td>)}
      <td><Celda valor={suma(v)} editable={ed} fila={fila} col={12} onFijar={fijar} onPegar={pegar} total /></td>
      <td className="n">{num(r)}</td>
      <td className="n">{r ? pct(suma(v) / r - 1) : ''}</td>
    </>
  }

  return (
    <div className="tarjeta">
      <div className="barra">
        <button className="link" onClick={onVolver}>← Todos los centros</button>
        <h3>{nombreDe(cat!.sedes, centro.sede)} · {nombreDe(cat!.unidades, centro.unidad)} · {nombreDe(cat!.lineas, centro.linea)}</h3>
        {!editable && <span className="chip">Solo lectura</span>}
        <div className="espacio" />
        <div className="segmentado">
          <button className={esquema === 'E1' ? 'activo' : ''} onClick={() => setEsquema('E1')}>Esquema 1</button>
          <button className={esquema === 'E2' ? 'activo' : ''} onClick={() => setEsquema('E2')}>Esquema 2</button>
        </div>
      </div>

      <div className="barra herramientas">
        <button onClick={() => setAbiertos(todasAbiertas ? new Set() : new Set(filasEsq.filter(f => f.tipo === 'rubro').map(f => f.rubro!)))}>
          {todasAbiertas ? 'Cerrar cuentas' : 'Abrir todas las cuentas'}</button>
        <label className="check"><input type="checkbox" checked={soloConDatos} onChange={e => setSoloConDatos(e.target.checked)} /> Sólo rubros con datos</label>
        <div className="espacio" />
        {editable && escRef && <button onClick={copiarReal}>Copiar real {anioRef} + %</button>}
        <button onClick={descargar}>Descargar Excel</button>
        {editable && <button onClick={() => setImportar(v => !v)}>Cargar Excel</button>}
        {editable && <button className="primario" disabled={!cambios.length || guardando} onClick={guardar}>
          {guardando ? 'Guardando…' : cambios.length ? `Guardar (${cambios.length})` : 'Guardado'}
        </button>}
      </div>
      {importar && <ImportarExcel esc={esc} onCerrar={() => setImportar(false)} onCargado={() => { setImportar(false); cargar() }} />}
      {msg && <div className={`alerta ${msg.tipo}`}>{msg.texto}</div>}
      <p className="ayuda">
        Digite por <strong>rubro</strong> (se reparte entre sus cuentas según lo ya presupuestado o el real {anioRef}) o abra el rubro con ▸ para
        digitar <strong>por cuenta mayor</strong>. Los importes van en <strong>positivo</strong>; los subtotales muestran el resultado con signo
        (gastos entre paréntesis). Puede pegar bloques de Excel; en la columna <em>Total</em> se reparte el año según la estacionalidad de {anioRef}.
      </p>

      <div className="scroll grilla-cont">
        <table className="tabla grilla esquema">
          <thead>
            <tr>
              <th className="fija">Rubro / cuenta</th>
              {MESES.map(m => <th key={m} className="n">{m}</th>)}
              <th className="n">Total {esc.anio}</th>
              <th className="n">Real {anioRef}</th>
              <th className="n">Var %</th>
            </tr>
          </thead>
          <tbody>
            {volumen.map(c => (
              <tr key={c.cuenta} className="fila-vol">
                <td className="fija">{c.nombre}</td>
                {filaCeldas(`C:${c.cuenta}`, valores.get(c.cuenta) ?? ceros(), editable, suma(ref.get(c.cuenta) ?? []))}
              </tr>
            ))}
            {orden.map(o => {
              if (o.tipo === 'cuenta') {
                const cta = o.cuenta
                const v = valores.get(cta) ?? ceros()
                const sucia = v.some((x, i) => Math.abs(x - (originales.get(cta)?.[i] ?? 0)) > 0.004)
                return (
                  <tr key={`c${cta}`} className={`fila-cuenta${sucia ? ' sucia' : ''}`}>
                    <td className="fija" style={{ paddingLeft: 8 + o.nivel * 16 }} title={cta}><span className="cod">{cta}</span> {cuentas.get(cta)?.nombre}</td>
                    {filaCeldas(`C:${cta}`, v, editable && puedeCuenta(cta), suma(ref.get(cta) ?? []))}
                  </tr>
                )
              }
              const { f, tieneHijos } = o
              if (f.tipo === 'rubro') {
                const ctas = cuentasPorRubro.get(f.rubro!) ?? []
                const s = signoRubro(ctas.map(c => cuentas.get(c)))
                const abierto = abiertos.has(f.rubro!)
                const sucia = ctas.some(c => (valores.get(c) ?? []).some((x, i) => Math.abs(x - (originales.get(c)?.[i] ?? 0)) > 0.004))
                return (
                  <tr key={f.clave} className={`fila-e fila-rubro n${f.nivel}${f.negrita ? ' b' : ''}${sucia ? ' sucia' : ''}`}>
                    <td className="fija" style={{ paddingLeft: 8 + f.nivel * 16 }}>
                      <button className="link flecha" disabled={!ctas.length} onClick={() => alternarRubro(f.rubro!)}
                        title={ctas.length ? (abierto ? 'Cerrar cuentas' : `Abrir ${ctas.length} cuenta(s)`) : 'Sin cuentas en el mapa'}>{ctas.length ? (abierto ? '▾' : '▸') : '·'}</button>
                      {f.etiqueta}
                    </td>
                    {filaCeldas(`R:${f.rubro}`, f.valores.slice(0, 12).map(x => r2(x * s)), editable && ctas.length > 0 && ctas.every(puedeCuenta), f.valores[12] * s)}
                  </tr>
                )
              }
              const tot = suma(f.valores.slice(0, 12)), r = f.valores[12]
              return (
                <tr key={f.clave} className={`fila-e fila-${f.tipo} n${f.nivel}${f.negrita ? ' b' : ''}${tieneHijos ? ' plegable' : ''}`}
                  onClick={tieneHijos ? () => alternarGrupo(f.clave) : undefined}>
                  <td className="fija" style={{ paddingLeft: 8 + f.nivel * 16 }}>
                    <span className="flecha">{tieneHijos ? (plegados.has(f.clave) ? '▸' : '▾') : ''}</span>{f.etiqueta}
                  </td>
                  {f.valores.slice(0, 12).map((x, i) => <td key={i} className="n">{num(x)}</td>)}
                  <td className="n b">{num(tot)}</td>
                  <td className="n">{num(r)}</td>
                  <td className="n">{r ? pct(tot / Math.abs(r) - Math.sign(r)) : ''}</td>
                </tr>
              )
            })}
          </tbody>
          {totalFinal && (
            <tfoot>
              <tr>
                <td className="fija">{totalFinal.etiqueta}</td>
                {totalFinal.valores.slice(0, 12).map((x, i) => <td key={i} className="n">{num(x)}</td>)}
                <td className="n b">{num(suma(totalFinal.valores.slice(0, 12)))}</td>
                <td className="n">{num(totalFinal.valores[12])}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
