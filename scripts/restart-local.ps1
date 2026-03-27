$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot

& (Join-Path $PSScriptRoot "stop-local.ps1")
& (Join-Path $PSScriptRoot "start-local.ps1")
