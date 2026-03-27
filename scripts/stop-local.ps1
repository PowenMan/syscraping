$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $root "storage\runtime"
$pidFile = Join-Path $runtimeDir "syscraping.pid"

if (-not (Test-Path $pidFile)) {
  Write-Output "No hay un PID guardado para Syscraping."
  exit 0
}

$existingPid = (Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1).Trim()

if (-not $existingPid) {
  Remove-Item $pidFile -ErrorAction SilentlyContinue
  Write-Output "No habia un PID valido. Archivo limpiado."
  exit 0
}

$runningProcess = Get-Process -Id $existingPid -ErrorAction SilentlyContinue

if ($runningProcess) {
  Stop-Process -Id $existingPid -Force
  Write-Output "Syscraping detenido. PID: $existingPid"
} else {
  Write-Output "El proceso $existingPid ya no estaba activo."
}

Remove-Item $pidFile -ErrorAction SilentlyContinue
