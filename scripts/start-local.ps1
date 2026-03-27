$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $root "storage\runtime"
$pidFile = Join-Path $runtimeDir "syscraping.pid"
$outLog = Join-Path $runtimeDir "syscraping.out.log"
$errLog = Join-Path $runtimeDir "syscraping.err.log"

New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

if (Test-Path $pidFile) {
  $existingPid = (Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1).Trim()

  if ($existingPid) {
    $runningProcess = Get-Process -Id $existingPid -ErrorAction SilentlyContinue

    if ($runningProcess) {
      Write-Output "Syscraping ya esta ejecutandose con PID $existingPid."
      Write-Output "URL: http://localhost:3000"
      Write-Output "Logs: $outLog"
      exit 0
    }
  }
}

$process = Start-Process `
  -FilePath "node" `
  -ArgumentList ".\src\server.js" `
  -WorkingDirectory $root `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog `
  -PassThru

Set-Content -Path $pidFile -Value $process.Id

Write-Output "Syscraping iniciado en segundo plano."
Write-Output "PID: $($process.Id)"
Write-Output "URL: http://localhost:3000"
Write-Output "Logs: $outLog"
