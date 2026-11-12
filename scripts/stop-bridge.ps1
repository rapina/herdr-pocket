param([switch]$Disable)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$bridgePath = Join-Path $projectRoot 'bridge\server.mjs'
# The scheduled task restarts the bridge within a minute. Use -Disable to keep it stopped.
if ($Disable -and (Get-ScheduledTask -TaskName 'Wired Bridge' -ErrorAction SilentlyContinue)) {
  Disable-ScheduledTask -TaskName 'Wired Bridge' | Out-Null
  Write-Output 'Disabled the Wired Bridge scheduled task. start-bridge.ps1 enables it again.'
}
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -like "*$bridgePath*" } | ForEach-Object { Stop-Process -Id $_.ProcessId }
