$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $root "storage\runtime"
$pidFile = Join-Path $runtimeDir "syscraping.pid"
$outLog = Join-Path $runtimeDir "syscraping.out.log"
$errLog = Join-Path $runtimeDir "syscraping.err.log"

if (-not (Test-Path $pidFile)) {
  Write-Output "Estado: detenido"
  exit 0
}

$existingPid = (Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1).Trim()

if (-not $existingPid) {
  Write-Output "Estado: detenido"
  exit 0
}

$runningProcess = Get-Process -Id $existingPid -ErrorAction SilentlyContinue

if ($runningProcess) {
  Write-Output "Estado: activo"
  Write-Output "PID: $existingPid"
  Write-Output "URL: http://localhost:3000"
  Write-Output "Salida: $outLog"
  Write-Output "Errores: $errLog"
  exit 0
}

Write-Output "Estado: detenido"
Write-Output "PID guardado sin proceso activo: $existingPid"
