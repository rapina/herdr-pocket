param([switch]$Direct)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$localFolder = Join-Path $projectRoot '.local'
New-Item -ItemType Directory -Force -Path $localFolder | Out-Null
$nodePath = (Get-Command node.exe).Source
$bridgePath = Join-Path $projectRoot 'bridge\server.mjs'
function Get-Bridge { Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -like "*$bridgePath*" } }
$running = Get-Bridge
if ($running) { Write-Output "Wired bridge is already running (PID $($running.ProcessId))."; exit 0 }

# When the scheduled task is installed, start through it so the bridge does not
# belong to this terminal and keeps running after the terminal closes.
$task = Get-ScheduledTask -TaskName 'Wired Bridge' -ErrorAction SilentlyContinue
if (-not $Direct -and $task) {
  if ($task.State -eq 'Disabled') { Enable-ScheduledTask -TaskName 'Wired Bridge' | Out-Null }
  Start-ScheduledTask -TaskName 'Wired Bridge'
  foreach ($i in 1..20) {
    Start-Sleep -Milliseconds 500
    $running = Get-Bridge
    if ($running) { Write-Output "Wired bridge started by the scheduled task (PID $($running.ProcessId))."; exit 0 }
  }
  throw 'The scheduled task did not start the bridge. See .local/bridge-error.log.'
}

$process = Start-Process -FilePath $nodePath -ArgumentList ('"' + $bridgePath + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $localFolder 'bridge.log') -RedirectStandardError (Join-Path $localFolder 'bridge-error.log') -PassThru
$process.Id | Set-Content (Join-Path $localFolder 'bridge.pid')
Write-Output "Wired bridge started (PID $($process.Id))."
