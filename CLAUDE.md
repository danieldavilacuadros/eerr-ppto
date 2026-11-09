# Contexto para Claude Code

Plataforma web de EERR y presupuesto de Incamotors. Dueño: Daniel Dávila Cuadros (jefe de intermediación
financiera). Responder en español. Ver `README.md` para módulos, roles y convenciones de datos.

## Reglas de Daniel

- **No tocar el proyecto Supabase `pci-incamotors` por ningún motivo.** `incamotors-fi` está pausado a propósito
  (no reactivarlo sin preguntar). No borrar datos ni proyectos.
- Cambios de esquema: archivo nuevo en `supabase/migrations/` (005_…, 006_…) ejecutado en el SQL Editor de Supabase;
  no editar los ya aplicados.
- Antes de hacer push a GitHub, decir qué se va a subir. Para web (GitHub, Supabase) usar Chrome (Claude in Chrome).

## Modelo vigente (desde 09/11/2026): mapa único + Esquema 1 y Esquema 2

Fuente: `Modelo EERR1 incamotors noviembre.xlsx` (carpeta superior). Lo convierte `scripts/generar_modelo.py` en
`supabase/datos_005_modelo.sql` (rubros, mapa, filas de esquemas, participaciones e IR 2026). Regenerar y volver a
ejecutar si cambia el Excel.

- **Mapa de cuentas** (`cuentas.nombre`, `cuentas.rubro`): un solo rubro por cuenta para todas las sedes, unidades,
  líneas y marcas, en real y presupuesto. Única excepción por unidad (`mapa_excepciones`): 7599100 en UNI = INCENTIVO
  FUERZA DE VENTAS (en el Excel la cuenta está partida a mano en dos filas). Editable en la página *Mapa de cuentas*.
- **Esquemas** (`esquema_filas`): filas tipo grupo (suma de hijas), rubro, formula (suma/resta de filas), pct, manual;
  niveles 0/1/2 como las agrupaciones del Excel. E1 = ER clásico; E2 = utilidad bruta por línea de negocio. Corregidas
  dos etiquetas mal copiadas del Excel (E2 fila 12 "UNIDADES -", fila 58 "POST VENTA - UTILIDAD BRUTA") y agregado el
  rubro OTROS INGRESOS Y GASTOS (7599101) que el Excel no sumaba.
- **Motor** `src/lib/esquema.ts`: probado contra el Excel (ene–set, cuadra todas las filas; sólo −15 soles de 7599101).
- **Participaciones e IR** (`montos_empresa`): sólo en el total de la empresa (reporte sin filtros); sólo admin/contab.
- **Empresa** (`lineas.empresa`): Nova Autos = Chevrolet e Isuzu (hoy sólo existe CHEVROL); Incamotors = resto.
- **Presupuesto**: grilla por rubro con la forma del esquema; cada rubro se abre en sus cuentas. Lo digitado en el rubro
  se reparte entre sus cuentas (`src/lib/reparto.ts`): según lo ya presupuestado, si no según el real del año anterior.
- Las vistas contable/comercial, la vista consolidada/general y los factores de distribución quedaron fuera de la app
  (sus tablas `rubros`, `mapeo_cuentas`, `consolidado_secciones`, `factores_distribucion` se conservan sin uso).
- **Extra libros = ajustes del mapa** (09/11/2026, decisión de Daniel): `supabase/datos_006_ajustes_mapa.sql`
  (generado por `scripts/generar_ajustes_mapa.py`) reemplazó los extra libros ene–set 2026 por "mapa del Excel − SAP"
  por cuenta y mes: 495 filas, S/ 5,183,104. Cada ajuste va al centro donde SAP tiene más monto de esa cuenta ese mes.
  Con eso el Esquema 1 de la web cuadra exacto con el Excel (UO 33,390,765; resultado 32,947,277; neto 23,227,825).
  Los extra libros anteriores (2,812 filas, ER por líneas) quedaron en `extra_libros_respaldo_20261109` (con RLS).
  Si SAP cambia algún mes ene–set, volver a ejecutar el script (recalcula). Octubre en adelante: sólo SAP.
- Comparativo 2025: pospuesto por pedido de Daniel (primero presupuesto y real 2026).

## Estado anterior (2026-11-05)

- **Web:** https://danieldavilacuadros.github.io/eerr-ppto/ (GitHub Pages, se publica con cada push a `main`).
- **Repositorio:** https://github.com/danieldavilacuadros/eerr-ppto (público; plan GitHub Free).
- **Supabase:** proyecto `eerr-ppto`, ref `tbjhilyaihzpkrignfkk`, región São Paulo, organización "Incamotors" (plan Free).
  - Migraciones aplicadas: `001_esquema`, `seed`, `002_extra_libros`, `003_distribucion_y_sap`, `004_rendimiento_rls`,
    `005_esquemas` + `datos_005_modelo.sql` (09/11/2026).
  - Usuario `daniel.davila@incamotors.pe` con rol `admin`. Auth › URL Configuration apunta a GitHub Pages.
- **Secretos GitHub:** existe `VITE_SUPABASE_ANON_KEY`. La URL va por defecto en `.github/workflows/deploy.yml`.
- **PC de Daniel (esta):** Node 26 LTS, `.env.local` con la Publishable key (no la secreta), VPN FortiClient para SAP.

### Datos cargados (Real 2026, enero–setiembre)

- **Real SAP:** 26,351 filas, S/ 30,629,155.07 (enero–junio de `SBO_INCA_PROD`, julio–setiembre de `SBO_INCAMOTORS_2026`).
- **Extra libros:** 2,812 celdas, S/ 5,246,038.62 = ER por líneas de contabilidad − SAP (sin reparto de GG en las líneas).
- **Factores de distribución:** 1,130 (GG y TC, ene–set) = reparto del ER ÷ ingresos de la línea en la plataforma.
- SAP + extra libros = S/ 35.88 M ≈ EEFF ene–set (35.82 M). Las 4 cuentas nuevas de SAP que faltaban se mapearon el
  05/11/2026 siguiendo a sus cuentas hermanas: 6551510 (cómputo) como 6551410/520/530; 7041084 (mano de obra propia)
  como 7041089; 7411186 (servicio de terceros) como la familia 741; 6861900 (sin nombre en SAP; en el ER va en la fila
  "Otros gastos") → contable `CD_OTROS_INGRESOS_Y_GASTOS`, comercial `MD_OTROS_GASTOS`. Ya no hay cuentas sin rubro.
- Fuente del ER: `ER X LINEAS DE NEGOCIO SETIEMBRE 2026-D.R_OK1.xlsx` (correo de Jorge Castro, 15/10/2026). Su hoja
  `CONTROL SEP.26` define cómo contabilidad asigna SAP a cada hoja; las reglas están replicadas en el script de carga.

### Módulos

- **Registro extra libros** (contabilidad/admin): grilla con la forma del "Modelo Registro Extra Libros" (sede, unidad,
  línea, cuenta, enero…diciembre), pegar desde Excel y cargar/descargar el Excel. Se suma al real en los reportes.
- **Estados de resultados:** Esquema 1 / Esquema 2, enero hasta el mes elegido + total, columnas %, agrupar por nivel
  (botones 1, 2, 3 como el Excel) o por fila, ver cuentas mayores, filtros línea de negocio/unidad/sede/marca/empresa,
  soles o dólares (por TC), exportar a Excel con las agrupaciones.
- **Mapa de cuentas:** nombre y rubro de cada cuenta, excepciones por unidad, catálogo de rubros.
- **Carga real:** botón "Actualizar desde SAP" que pide sólo el último mes cerrado, una vez al día (tabla `sap_pedidos`).

### Vínculo con SAP

- Script `scripts/sap_sincronizar_real.ps1` (sólo lectura en SAP, usuario RS2 con credencial DPAPI de PCI en
  `%LOCALAPPDATA%\PCI\sap_credencial.xml`; credencial de la plataforma en `%LOCALAPPDATA%\EERR\plataforma_credencial.xml`).
  - `-Desde AAAA-MM [-Hasta AAAA-MM]` barre meses y reemplaza el real (no toca extra libros).
  - `-Pedidos` atiende el botón de la web. **Una actualización (un mes) por día** (pedido de Daniel, 06/11/2026): la web
    permite un pedido diario (los que terminan en error no cuentan) y el script atiende como máximo uno por día (el más
    reciente; los demás quedan pendientes). Tarea de Windows **"EERR - Sincronizar SAP"** sólo **al iniciar sesión** (2 min
    de retraso): espera hasta 30 min a que se conecte la VPN y sale si no hay pedidos. Log en
    `%LOCALAPPDATA%\EERR\sap_sincronizar_real.log`.
  - Reglas: sin sede/TAC → AQP; sin unidad → GEN; PLYP → REP; sin línea → GENERAL; PREMIUN → VOLVO; excluye 60x/61x/79x.
- Bases SAP: hasta jun-2026 `SBO_INCA_PROD`; desde jul-2026 `SBO_INCAMOTORS_2026` (su 30/06 es saldo inicial sin centro:
  el cierre de junio — planilla, depreciación, ventas de fin de mes — sólo está ahí y va como extra libros).

### Hallazgos del cuadre (para explicar diferencias SAP vs ER)

- SAP Arequipa factura Hyundai comerciales (County, HD, Pavise) con línea HPV; contabilidad los pasa a la hoja HCV.
- Ventas a empresas/flotas → hoja CORPORATIV; comisión de intermediación financiera (7521200) en UNI/ACC → Financiamiento.
- Extra libros recurrentes: bono retail devengado (~13.7 M ene–set), rappel Mobil repartido entre sedes, producto
  regalado de costo a obsequios, provisión de desvalorización de existencias, comisión IF devengada (enero).

## Pendientes

1. Revisar en la web el Esquema 1 y 2 y el presupuesto por rubro. Confirmar con contabilidad el nombre y el rubro de
   6861900. Ajustes de octubre en adelante: definir quién los registra (hoy el mapa del Excel llega a setiembre).
2. Botón "Actualizar desde SAP" probado el 06/11/2026: octubre 2026 = 3,459 filas, S/ 5,761,433.18 (sólo SAP, sin extra
   libros; en línea con jul–ago). Trajo 5 cuentas nuevas, mapeadas copiando a una hermana: 6551100←6551300,
   6911124←6911107, 6941095←6941094, 7011124←7011107, 7411107←7411118. Cada mes nuevo puede traer cuentas nuevas:
   revisar *Mapa de cuentas* › "Solo sin rubro" después de cada carga.
3. Los ajustes del mapa no traen sede/marca: por sede o marca los reportes muestran el ajuste en el centro de mayor
   monto SAP. Si contabilidad entrega el detalle por centro, cargarlo en *Registro extra libros*.
4. Invitar a los jefes (Supabase › Auth › Invite user) y asignarles rol y accesos en *Usuarios*.
5. No se ha recibido archivo de PPTO 2027; si llega, adaptar la importación.
6. Revisar mapeos asignados por regla general (p. ej. 6281100 Retribuciones al directorio, 7011191/7011102 en ACC).
7. Definir si los gastos generales (unidad GEN) se reparten a las líneas en el Esquema 2 (antes: factores de distribución).
8. Editor de esquemas en la app (hoy las filas se cambian regenerando desde el Excel).

## Trabajo local

```bash
npm install
cp .env.example .env.local   # VITE_SUPABASE_URL=https://tbjhilyaihzpkrignfkk.supabase.co y la Publishable key
npm run dev
```

Archivos de trabajo (no se suben): `datos_locales/` (excluida en `.git/info/exclude`) con los cuadres y los archivos de
carga `Carga_real_SAP_ene-set26.xlsx` y `Extra_libros_ene-set26.xlsx`.
