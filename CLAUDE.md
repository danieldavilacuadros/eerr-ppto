# Contexto para Claude Code

Plataforma web de EERR y presupuesto de Incamotors. Dueño: Daniel Dávila Cuadros (jefe de intermediación
financiera). Responder en español. Ver `README.md` para módulos, roles y convenciones de datos.

## Reglas de Daniel

- **No tocar el proyecto Supabase `pci-incamotors` por ningún motivo.** `incamotors-fi` está pausado a propósito
  (no reactivarlo sin preguntar). No borrar datos ni proyectos.
- Cambios de esquema: archivo nuevo en `supabase/migrations/` (005_…, 006_…) ejecutado en el SQL Editor de Supabase;
  no editar los ya aplicados.
- Antes de hacer push a GitHub, decir qué se va a subir. Para web (GitHub, Supabase) usar Chrome (Claude in Chrome).

## Estado actual (2026-11-05)

- **Web:** https://danieldavilacuadros.github.io/eerr-ppto/ (GitHub Pages, se publica con cada push a `main`).
- **Repositorio:** https://github.com/danieldavilacuadros/eerr-ppto (público; plan GitHub Free).
- **Supabase:** proyecto `eerr-ppto`, ref `tbjhilyaihzpkrignfkk`, región São Paulo, organización "Incamotors" (plan Free).
  - Migraciones aplicadas: `001_esquema`, `seed`, `002_extra_libros`, `003_distribucion_y_sap`, `004_rendimiento_rls`.
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

### Módulos nuevos

- **Registro extra libros** (contabilidad/admin): grilla con la forma del "Modelo Registro Extra Libros" (sede, unidad,
  línea, cuenta, enero…diciembre), pegar desde Excel y cargar/descargar el Excel. Se suma al real en los reportes.
- **Estados de resultados:** botones *Vista completa por cuenta contable*, *Vista resumida por rubros* y *Vista
  consolidada* (Ingresos, Costos, Margen bruto, Gastos, Margen de contribución). Con Línea comercial, Unidad y Línea en
  "Todas" la consolidada pasa a **vista general**: una columna por línea de negocio hasta el Resultado Operativo Neto,
  con gastos generales y TC repartidos por factor (último factor disponible para meses sin factor). Secciones y rubros
  plegables.
- **Mapeo de cuentas:** además del rubro de cada cuenta (filtro "Solo sin clasificar"), tarjeta *Agrupación de la vista
  consolidada* (tabla `consolidado_secciones`).
- **Carga real:** botón "Actualizar desde SAP" que pide sólo el último mes cerrado (tabla `sap_pedidos`).

### Vínculo con SAP

- Script `scripts/sap_sincronizar_real.ps1` (sólo lectura en SAP, usuario RS2 con credencial DPAPI de PCI en
  `%LOCALAPPDATA%\PCI\sap_credencial.xml`; credencial de la plataforma en `%LOCALAPPDATA%\EERR\plataforma_credencial.xml`).
  - `-Desde AAAA-MM [-Hasta AAAA-MM]` barre meses y reemplaza el real (no toca extra libros).
  - `-Pedidos` atiende el botón de la web. Tarea de Windows **"EERR - Sincronizar SAP"** cada 5 min (sale si no hay VPN
    o pedidos). Log en `%LOCALAPPDATA%\EERR\sap_sincronizar_real.log`.
  - Reglas: sin sede/TAC → AQP; sin unidad → GEN; PLYP → REP; sin línea → GENERAL; PREMIUN → VOLVO; excluye 60x/61x/79x.
- Bases SAP: hasta jun-2026 `SBO_INCA_PROD`; desde jul-2026 `SBO_INCAMOTORS_2026` (su 30/06 es saldo inicial sin centro:
  el cierre de junio — planilla, depreciación, ventas de fin de mes — sólo está ahí y va como extra libros).

### Hallazgos del cuadre (para explicar diferencias SAP vs ER)

- SAP Arequipa factura Hyundai comerciales (County, HD, Pavise) con línea HPV; contabilidad los pasa a la hoja HCV.
- Ventas a empresas/flotas → hoja CORPORATIV; comisión de intermediación financiera (7521200) en UNI/ACC → Financiamiento.
- Extra libros recurrentes: bono retail devengado (~13.7 M ene–set), rappel Mobil repartido entre sedes, producto
  regalado de costo a obsequios, provisión de desvalorización de existencias, comisión IF devengada (enero).

## Pendientes

1. Confirmar con contabilidad el nombre y el rubro de 6861900, y que la vista general ya no muestre "sin clasificar".
2. Botón "Actualizar desde SAP" probado el 06/11/2026: octubre 2026 = 3,459 filas, S/ 5,761,433.18 (sólo SAP, sin extra
   libros; en línea con jul–ago). Trajo 5 cuentas nuevas, mapeadas copiando a una hermana: 6551100←6551300,
   6911124←6911107, 6941095←6941094, 7011124←7011107, 7411107←7411118. Cada mes nuevo puede traer cuentas nuevas:
   revisar *Mapeo de cuentas* › "Solo sin clasificar" después de cada carga.
3. Pedir a Jorge Castro su registro extra libros mensual 2026 (formato del modelo) para reemplazar los calculados.
4. Invitar a los jefes (Supabase › Auth › Invite user) y asignarles rol y accesos en *Usuarios*.
5. No se ha recibido archivo de PPTO 2027; si llega, adaptar la importación.
6. Revisar mapeos asignados por regla general (p. ej. 6281100 Retribuciones al directorio, 7011191/7011102 en ACC).
7. Validar con contabilidad el factor de distribución para meses nuevos (hoy usa el último factor disponible).

## Trabajo local

```bash
npm install
cp .env.example .env.local   # VITE_SUPABASE_URL=https://tbjhilyaihzpkrignfkk.supabase.co y la Publishable key
npm run dev
```

Archivos de trabajo (no se suben): `datos_locales/` (excluida en `.git/info/exclude`) con los cuadres y los archivos de
carga `Carga_real_SAP_ene-set26.xlsx` y `Extra_libros_ene-set26.xlsx`.
