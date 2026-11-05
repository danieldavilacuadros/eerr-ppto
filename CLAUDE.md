# Contexto para Claude Code

Plataforma web de EERR y presupuesto de Incamotors. Dueño: Daniel Dávila Cuadros (jefe de intermediación
financiera). Responder en español. Ver `README.md` para módulos, roles y convenciones de datos.

## Estado actual (2026-11-05)

- **Web publicada:** https://danieldavilacuadros.github.io/eerr-ppto/ (GitHub Pages, se publica con cada push a `main`).
- **Repositorio:** https://github.com/danieldavilacuadros/eerr-ppto (público; plan GitHub Free).
- **Supabase:** proyecto `eerr-ppto`, ref `tbjhilyaihzpkrignfkk`, región São Paulo, organización "Incamotors" (plan Free).
  - Ya se ejecutaron `supabase/migrations/001_esquema.sql` y `supabase/seed.sql`
    (301 cuentas, 172 rubros, 608 mapeos, 187 centros, 3 escenarios, 12 tipos de cambio).
  - Usuario `daniel.davila@incamotors.pe` creado con rol `admin`.
  - Auth › URL Configuration: Site URL y Redirect URL apuntan a la web de GitHub Pages.
  - El proyecto `incamotors-fi` se pausó para liberar cupo del plan Free. **No tocar `pci-incamotors` por ningún motivo.**
- **Secretos GitHub:** existe `VITE_SUPABASE_ANON_KEY`. La URL de Supabase va por defecto en `.github/workflows/deploy.yml`.

## Pendientes

1. Que Daniel confirme el ingreso a la web y revise el módulo de presupuesto con datos reales.
2. Invitar a los jefes (Supabase › Auth › Invite user) y asignarles rol y accesos en la página *Usuarios*.
3. Cargar real 2026 ene–set: falta la base SAP con sede/unidad/línea por movimiento.
4. No se ha recibido archivo de PPTO 2027; si llega, adaptar la importación.
5. Distribución de gastos generales (GEN) a las líneas con factor de reparto.
6. Revisar mapeos asignados por regla general (p. ej. 6281100 Retribuciones al directorio).

## Trabajo local

```bash
npm install
cp .env.example .env.local   # VITE_SUPABASE_URL=https://tbjhilyaihzpkrignfkk.supabase.co y la clave anon
npm run dev
```

Los cambios de esquema van como nuevos archivos en `supabase/migrations/` (002_..., 003_...) y se ejecutan en el
SQL Editor de Supabase; no editar los ya aplicados.
