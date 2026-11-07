$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$localFolder = Join-Path $projectRoot '.local'
New-Item -ItemType Directory -Force -Path $localFolder | Out-Null
$nodePath = (Get-Command node.exe).Source
$bridgePath = Join-Path $projectRoot 'bridge\server.mjs'
$running = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -like "*$bridgePath*" }
if ($running) { Write-Output "Herdr Pocket is already running (PID $($running.ProcessId))."; exit 0 }
$process = Start-Process -FilePath $nodePath -ArgumentList ('"' + $bridgePath + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $localFolder 'bridge.log') -RedirectStandardError (Join-Path $localFolder 'bridge-error.log') -PassThru
$process.Id | Set-Content (Join-Path $localFolder 'bridge.pid')
Write-Output "Herdr Pocket started (PID $($process.Id))."
