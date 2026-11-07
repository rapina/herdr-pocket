$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$bridgePath = Join-Path $projectRoot 'bridge\server.mjs'
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -like "*$bridgePath*" } | ForEach-Object { Stop-Process -Id $_.ProcessId }
