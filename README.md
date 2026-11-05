# Incamotors · EERR y Presupuesto

Plataforma web para que cada líder de área revise sus estados de resultados (real 2026, real 2027) y cargue el
presupuesto 2027 por **sede · unidad de negocio · línea/marca · cuenta mayor · mes**, con vista **contable** (ERI)
y vista **comercial** (ER por línea de negocio) que siempre cuadran entre sí.

- Frontend: React + Vite (sitio estático, publicado en GitHub Pages)
- Base de datos, usuarios y seguridad: Supabase (Postgres + Auth + Row Level Security)

## Qué incluye

| Módulo | Quién | Qué hace |
|---|---|---|
| Carga de presupuesto | jefes, admin | Grilla por centro (sede/unidad/marca) con 12 meses, referencia real del año anterior y variación. Pegar desde Excel, repartir un total anual según la estacionalidad, copiar el real + %, descargar/cargar plantilla Excel de todos sus centros. |
| Estados de resultados | todos | Mes a mes, un mes, acumulado o año; comparativo contra otro escenario; vista contable o comercial; detalle por cuenta mayor; soles o dólares; exportar a Excel. Indicador de cuadre contable vs comercial. |
| Ajustes y provisiones | contabilidad | Provisiones, reclasificaciones (suma cero) y asignaciones sobre cuentas mayores y centros. |
| Carga real (SAP) | contabilidad | Sube el detalle contable del mes (año, mes, sede, unidad, línea, cuenta, importe) y reemplaza esos meses. |
| Mapeo de cuentas | contabilidad | Define a qué rubro contable y comercial va cada cuenta mayor (y excepciones por unidad). |
| Usuarios y accesos | admin | Rol de cada usuario y su alcance (sede / unidad / línea / prefijo de cuenta, con o sin edición). Escenarios abiertos/cerrados. |

### Roles

- **admin**: todo.
- **contabilidad**: ve todo; carga real, ajustes y mapeos; edita presupuesto sólo donde tenga accesos con edición.
- **jefe**: ve y edita presupuesto según sus accesos.
- **lectura**: sólo ve según sus accesos.

El alcance se define con filas de acceso (vacío = todas). Ejemplos:

- Jefe de intermediación financiera: `unidad = Intermediación financiera` y `unidad = Equipamiento y accesorios`, todas las sedes, edita.
- Jefe de unidades Cusco: `sede = Cusco, unidad = Venta de unidades, línea = Hyundai` (una fila por marca), edita;
  más `sede = Cusco, unidad = Intermediación financiera` sin editar para ver lo que le corresponde.

La seguridad se aplica en la base de datos (RLS): aunque alguien manipule la web, sólo puede leer o grabar lo que su rol permite.

## Puesta en marcha (una sola vez)

### 1. Supabase
1. Cree un proyecto en https://supabase.com (región São Paulo recomendada).
2. En **SQL Editor** ejecute, en este orden:
   - `supabase/migrations/001_esquema.sql`
   - `supabase/seed.sql` (cuentas, estructura contable y comercial, sedes, unidades, marcas, centros y tipo de cambio 2026)
3. En **Authentication › Users › Add user / Invite user** cree su usuario.
4. Hágase administrador (SQL Editor):
   ```sql
   update perfiles set rol = 'admin', nombre = 'Su nombre' where email = 'su-correo@incamotors.pe';
   ```
5. En **Authentication › URL Configuration** agregue la URL de GitHub Pages (paso 2) en *Site URL* y *Redirect URLs*
   (necesario para los enlaces de ingreso por correo).

### 2. GitHub
1. Cree un repositorio y suba esta carpeta (sin `node_modules`).
2. En **Settings › Secrets and variables › Actions** cree:
   - `VITE_SUPABASE_URL` → Supabase › Project Settings › API › Project URL
   - `VITE_SUPABASE_ANON_KEY` → la clave `anon public` (es pública por diseño; la seguridad la da RLS)
3. En **Settings › Pages › Source** elija **GitHub Actions**.
4. Cada `push` a `main` publica la web en `https://<usuario>.github.io/<repositorio>/`.

### 3. Uso local (opcional)
```bash
npm install
cp .env.example .env.local   # complete con sus datos de Supabase
npm run dev
```

## Datos

- Montos en soles con **signo de resultado**: ingresos (+), costos y gastos (−). En la grilla de presupuesto
  los jefes digitan en positivo y el sistema aplica el signo según la cuenta (clase 6 = gasto).
- `VOL` es una cuenta estadística (unidades vendidas / litros) que no suma en los resultados.
- `scripts/generar_seed.py` regenera `supabase/seed.sql` desde los Excel de origen:
  ```bash
  python scripts/generar_seed.py "Incamotors_EEFF_Ene-Set_25vs26 (NUEVO MODELO).xlsx" "ER X LINEAS DE NEGOCIO SETIEMBRE 2026.xlsx"
  ```
  - Vista contable: hoja `2026` (ERI1/ERI2) presentada como `ERI_SOLES`.
  - Vista comercial: plantilla de rubros de las hojas por línea (col. A = cuentas) + reglas por familia de cuenta.
  - Centros sede/unidad/línea: hoja `CONTROL SEP.26`.

## Pendientes conocidos
- Distribución automática de gastos generales a las líneas (factor de distribución) — hoy GEN se ve como su propia unidad.
- Carga del real 2026 enero–setiembre: requiere la base de datos SAP con sede/unidad/línea por movimiento (formato de *Carga real*).
- Revisar en *Mapeo de cuentas* las cuentas asignadas por regla general (p. ej. 6281100 Retribuciones al directorio).
