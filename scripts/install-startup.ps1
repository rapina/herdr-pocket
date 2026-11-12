$ErrorActionPreference = 'Stop'
# Registers a per-user scheduled task that starts the bridge at sign-in and
# checks every minute, restarting it if the process has exited. Processes
# started by Task Scheduler do not depend on the terminal that ran this script.
$taskName = 'Wired Bridge'
$startScript = Join-Path $PSScriptRoot 'start-bridge.ps1'
$projectRoot = Split-Path -Parent $PSScriptRoot
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name

$arguments = '--headless "' + (Get-Command powershell.exe).Source + '" -NoProfile -ExecutionPolicy Bypass -File "' + $startScript + '" -Direct'
$action = New-ScheduledTaskAction -Execute (Join-Path $env:SystemRoot 'System32\conhost.exe') -Argument $arguments -WorkingDirectory $projectRoot
$logon = New-ScheduledTaskTrigger -AtLogOn -User $user
$repeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $logon, $repeat -Settings $settings -Principal $principal -Description 'Start the Wired bridge at sign-in and restart it if it stops' -Force | Out-Null

# Older versions used a Startup folder shortcut instead.
$oldShortcut = Join-Path ([Environment]::GetFolderPath('Startup')) 'Herdr Pocket Bridge.lnk'
if (Test-Path $oldShortcut) { Remove-Item $oldShortcut }

Write-Output "Installed scheduled task: $taskName"
