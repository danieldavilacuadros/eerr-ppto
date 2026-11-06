# EERR y PPTO · Sincroniza el REAL desde SAP Business One (sólo lectura) a la plataforma (Supabase).
#
# Usos (desde la carpeta del proyecto, con la VPN conectada):
#   1) Guardar una vez la credencial de la plataforma (su correo y clave; se guarda cifrada para este usuario de Windows):
#        powershell -ExecutionPolicy Bypass -File scripts\sap_sincronizar_real.ps1 -GuardarCredencial
#   2) Barrer varios meses (script):
#        powershell -ExecutionPolicy Bypass -File scripts\sap_sincronizar_real.ps1 -Desde 2026-01 -Hasta 2026-09
#   3) Atender los pedidos del botón "Actualizar desde SAP" de la web (sólo el último mes, máximo uno por día):
#        powershell -ExecutionPolicy Bypass -File scripts\sap_sincronizar_real.ps1 -Pedidos
#      (tarea de Windows "EERR - Sincronizar SAP" al iniciar sesión: espera hasta 30 min la VPN; sale sin hacer nada
#       si no hay pedidos, si hoy ya atendió uno o si no ve SAP)
#
# Requiere: credencial SAP de solo lectura guardada con sap_guardar_credencial.ps1 (%LOCALAPPDATA%\PCI\sap_credencial.xml)
# y el archivo .env.local del proyecto con VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.
# Bases SAP: hasta junio 2026 SBO_INCA_PROD; desde julio 2026 SBO_INCAMOTORS_2026.
# Reglas (iguales al archivo de carga): sin sede → AQP; TAC → AQP; sin unidad → GEN; PLYP → REP; sin línea → GENERAL;
# PREMIUN → VOLVO. Se excluyen 60x/61x (compras y variación de existencias) y 79x (cargas imputables).
param(
  [string]$Desde = '',
  [string]$Hasta = '',
  [switch]$Pedidos,
  [switch]$GuardarCredencial
)
$ErrorActionPreference = 'Stop'
$DIR = Join-Path $env:LOCALAPPDATA 'EERR'
New-Item -ItemType Directory -Force $DIR | Out-Null
$CRED_PLAT = Join-Path $DIR 'plataforma_credencial.xml'
$LOG = Join-Path $DIR 'sap_sincronizar_real.log'

if ($GuardarCredencial) {
  $correo = Read-Host 'Correo de la plataforma (admin o contabilidad)'
  $clave = Read-Host 'Clave de la plataforma' -AsSecureString
  New-Object System.Management.Automation.PSCredential($correo.Trim(), $clave) | Export-Clixml $CRED_PLAT
  "Guardado en $CRED_PLAT (cifrado para este usuario de Windows)."
  return
}

# ------------------------------------------------------------------ configuración
$proyecto = Split-Path -Parent $PSScriptRoot
$env_ = @{}
Get-Content (Join-Path $proyecto '.env.local') | Where-Object { $_ -match '^\s*([A-Z_]+)\s*=\s*(.*)$' } | ForEach-Object { $env_[$Matches[1]] = $Matches[2].Trim() }
$URL = $env_['VITE_SUPABASE_URL']; $KEY = $env_['VITE_SUPABASE_ANON_KEY']
if (-not $URL -or -not $KEY) { throw 'Falta VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY en .env.local' }
$cfgSap = Import-Clixml (Join-Path $env:LOCALAPPDATA 'PCI\sap_credencial.xml')

function SapVisible {
  $tcp = New-Object Net.Sockets.TcpClient
  try { return ($tcp.ConnectAsync($cfgSap.Servidor, 1433).Wait(3000) -and $tcp.Connected) } catch { return $false } finally { $tcp.Close() }
}
if ($Pedidos) {
  # modo programado (al iniciar sesión en Windows): espera hasta 30 min a que se conecte la VPN; si no, sale sin hacer nada
  $limite = (Get-Date).AddMinutes(30)
  while (-not (SapVisible)) {
    if ((Get-Date) -gt $limite) { return }
    Start-Sleep -Seconds 60
  }
}

# ------------------------------------------------------------------ sesión en la plataforma
if (-not (Test-Path $CRED_PLAT)) { throw "Falta la credencial de la plataforma: ejecute con -GuardarCredencial" }
$cp = Import-Clixml $CRED_PLAT
$cuerpo = @{ email = $cp.UserName; password = $cp.GetNetworkCredential().Password } | ConvertTo-Json
$token = (Invoke-RestMethod -Method Post -Uri "$URL/auth/v1/token?grant_type=password" -Headers @{ apikey = $KEY } -ContentType 'application/json' -Body $cuerpo).access_token
$cuerpo = $null
$HDR = @{ apikey = $KEY; Authorization = "Bearer $token" }
function Api($metodo, $ruta, $datos = $null, $extra = @{}) {
  $hd = $HDR.Clone(); foreach ($k in $extra.Keys) { $hd[$k] = $extra[$k] }
  if ($null -ne $datos) {
    $json = ConvertTo-Json @($datos) -Depth 4 -Compress
    return Invoke-RestMethod -Method $metodo -Uri "$URL/rest/v1/$ruta" -Headers $hd -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($json))
  }
  return Invoke-RestMethod -Method $metodo -Uri "$URL/rest/v1/$ruta" -Headers $hd
}

# ------------------------------------------------------------------ lectura SAP de un mes
function LeerSap([int]$anio, [int]$mes) {
  $base = if ($anio -lt 2026 -or ($anio -eq 2026 -and $mes -le 6)) { 'SBO_INCA_PROD' } else { 'SBO_INCAMOTORS_2026' }
  $ini = (Get-Date -Year $anio -Month $mes -Day 1).ToString('yyyyMMdd')
  $fin = (Get-Date -Year $anio -Month $mes -Day 1).AddMonths(1).ToString('yyyyMMdd')
  # Base nueva: el 30/06/2026 trae el saldo inicial (asientos manuales sin centro) → sólo se usa desde julio
  $sql = @"
SELECT ISNULL(NULLIF(J.OcrCode2,''),'') AS Sede, ISNULL(NULLIF(J.OcrCode3,''),'') AS Unidad, ISNULL(NULLIF(J.OcrCode4,''),'') AS Linea,
  J.Account AS Cuenta, MAX(A.AcctName) AS Nombre, CAST(SUM(J.Credit - J.Debit) AS DECIMAL(18,2)) AS Importe
FROM JDT1 J WITH (NOLOCK) JOIN OACT A WITH (NOLOCK) ON A.AcctCode = J.Account
WHERE J.RefDate >= '$ini' AND J.RefDate < '$fin' AND LEFT(J.Account,1) IN ('6','7') AND LEFT(J.Account,2) NOT IN ('60','61','79')
GROUP BY ISNULL(NULLIF(J.OcrCode2,''),''), ISNULL(NULLIF(J.OcrCode3,''),''), ISNULL(NULLIF(J.OcrCode4,''),''), J.Account
HAVING ABS(SUM(J.Credit - J.Debit)) >= 0.005
"@
  $b = New-Object System.Data.SqlClient.SqlConnectionStringBuilder
  $b['Data Source'] = $cfgSap.Servidor; $b['Initial Catalog'] = $base
  $b['User ID'] = $cfgSap.Credencial.UserName; $b['Password'] = $cfgSap.Credencial.GetNetworkCredential().Password
  $b['Connect Timeout'] = 15; $b['ApplicationIntent'] = 'ReadOnly'
  $cn = New-Object System.Data.SqlClient.SqlConnection $b.ConnectionString
  try {
    $cn.Open()
    $cmd = $cn.CreateCommand(); $cmd.CommandText = $sql; $cmd.CommandTimeout = 300
    $t = New-Object System.Data.DataTable; $t.Load($cmd.ExecuteReader())
  } finally { $cn.Close() }
  $agr = @{}
  foreach ($r in $t.Rows) {
    $se = "$($r.Sede)".Trim(); $u = "$($r.Unidad)".Trim(); $l = "$($r.Linea)".Trim()
    if (-not $se -or $se -eq 'TAC') { $se = 'AQP' }
    if (-not $u) { $u = 'GEN' } elseif ($u -eq 'PLYP') { $u = 'REP' }
    if (-not $l) { $l = 'GENERAL' } elseif ($l -eq 'PREMIUN') { $l = 'VOLVO' }
    $k = "$se|$u|$l|$($r.Cuenta)"
    if (-not $agr.ContainsKey($k)) { $agr[$k] = [pscustomobject]@{ sede = $se; unidad = $u; linea = $l; cuenta = "$($r.Cuenta)"; nombre = "$($r.Nombre)".Trim(); monto = 0.0 } }
    $agr[$k].monto += [double]$r.Importe
  }
  return @{ base = $base; filas = @($agr.Values | Where-Object { [math]::Abs($_.monto) -ge 0.005 }) }
}

# ------------------------------------------------------------------ carga de un mes en la plataforma
function CargarMes([int]$anio, [int]$mes) {
  $esc = @(Api Get "escenarios?tipo=eq.real&anio=eq.$anio&select=id")[0]
  if (-not $esc) { throw "No existe escenario real $anio en la plataforma" }
  $sap = LeerSap $anio $mes
  $filas = $sap.filas
  # catálogos: líneas, cuentas y centros nuevos
  $lineas = @(Api Get 'lineas?select=codigo') | ForEach-Object { $_.codigo }
  $nuevasL = @($filas | ForEach-Object { $_.linea } | Sort-Object -Unique | Where-Object { $lineas -notcontains $_ })
  if ($nuevasL.Count) { Api Post 'lineas?on_conflict=codigo' @($nuevasL | ForEach-Object { @{ codigo = $_; nombre = $_ } }) @{ Prefer = 'resolution=merge-duplicates,return=minimal' } | Out-Null }
  $cuentas = @(Api Get 'cuentas?select=cuenta') | ForEach-Object { $_.cuenta }
  $nuevasC = @($filas | Where-Object { $cuentas -notcontains $_.cuenta } | Sort-Object cuenta -Unique)
  if ($nuevasC.Count) { Api Post 'cuentas?on_conflict=cuenta' @($nuevasC | ForEach-Object { @{ cuenta = $_.cuenta; nombre = $_.nombre; clase = $_.cuenta.Substring(0, 1) } }) @{ Prefer = 'resolution=merge-duplicates,return=minimal' } | Out-Null }
  $centros = @($filas | ForEach-Object { "$($_.sede)|$($_.unidad)|$($_.linea)" } | Sort-Object -Unique | ForEach-Object { $p = $_.Split('|'); @{ sede = $p[0]; unidad = $p[1]; linea = $p[2] } })
  for ($i = 0; $i -lt $centros.Count; $i += 500) {
    Api Post 'centros?on_conflict=sede,unidad,linea' @($centros[$i..([Math]::Min($i + 499, $centros.Count - 1))]) @{ Prefer = 'resolution=ignore-duplicates,return=minimal' } | Out-Null
  }
  # reemplazo del mes
  Api Delete "real_montos?escenario_id=eq.$($esc.id)&anio=eq.$anio&mes=eq.$mes" $null @{ Prefer = 'return=minimal' } | Out-Null
  $lote = [guid]::NewGuid().ToString()
  $reg = @($filas | ForEach-Object { @{ escenario_id = $esc.id; anio = $anio; mes = $mes; sede = $_.sede; unidad = $_.unidad; linea = $_.linea; cuenta = $_.cuenta; monto = [math]::Round($_.monto, 2); lote = $lote } })
  for ($i = 0; $i -lt $reg.Count; $i += 500) {
    Api Post 'real_montos' @($reg[$i..([Math]::Min($i + 499, $reg.Count - 1))]) @{ Prefer = 'return=minimal' } | Out-Null
  }
  $total = ($filas | Measure-Object -Property monto -Sum).Sum
  return "{0}-{1:00}: {2} filas desde {3}, resultado S/ {4:N2}, {5} cuenta(s) y {6} línea(s) nuevas" -f $anio, $mes, $reg.Count, $sap.base, $total, $nuevasC.Count, $nuevasL.Count
}

# ------------------------------------------------------------------ ejecución
if ($Pedidos) {
  # PowerShell 5.1 convierte la lista vacía [] en un elemento nulo: se filtran los que no traen id
  $pend = @(Api Get 'sap_pedidos?estado=eq.pendiente&order=pedido_en.asc&select=id,anio,mes' | ForEach-Object { $_ } | Where-Object { $_ -and $_.id })
  if (-not $pend.Count) { return }
  # como máximo UN mes por día: si hoy ya se atendió un pedido, los pendientes esperan al siguiente día
  $hoyUtc = (Get-Date).Date.ToUniversalTime().ToString('o')
  $hechos = @(Api Get "sap_pedidos?estado=eq.ok&atendido_en=gte.$hoyUtc&select=id" | ForEach-Object { $_ } | Where-Object { $_ -and $_.id })
  if ($hechos.Count) { return }
  $pend = @($pend | Select-Object -Last 1)   # el pedido más reciente; los anteriores quedan pendientes
  Start-Transcript -Path $LOG -Append | Out-Null
  foreach ($p in $pend) {
    Api Patch "sap_pedidos?id=eq.$($p.id)" @{ estado = 'procesando' } @{ Prefer = 'return=minimal' } | Out-Null
    try {
      $m = CargarMes ([int]$p.anio) ([int]$p.mes)
      Api Patch "sap_pedidos?id=eq.$($p.id)" @{ estado = 'ok'; mensaje = $m; atendido_en = (Get-Date).ToUniversalTime().ToString('o'); atendido_por = $env:COMPUTERNAME } @{ Prefer = 'return=minimal' } | Out-Null
      $m
    } catch {
      Api Patch "sap_pedidos?id=eq.$($p.id)" @{ estado = 'error'; mensaje = "$($_.Exception.Message)"; atendido_en = (Get-Date).ToUniversalTime().ToString('o'); atendido_por = $env:COMPUTERNAME } @{ Prefer = 'return=minimal' } | Out-Null
      "Error en pedido $($p.id): $($_.Exception.Message)"
    }
  }
  Stop-Transcript | Out-Null
  return
}

if (-not $Desde) { throw 'Indique -Desde AAAA-MM (y opcional -Hasta AAAA-MM), o use -Pedidos' }
if (-not $Hasta) { $Hasta = $Desde }
$dIni = [datetime]::ParseExact("$Desde-01", 'yyyy-MM-dd', $null); $dFin = [datetime]::ParseExact("$Hasta-01", 'yyyy-MM-dd', $null)
for ($m = $dIni; $m -le $dFin; $m = $m.AddMonths(1)) { CargarMes $m.Year $m.Month }
