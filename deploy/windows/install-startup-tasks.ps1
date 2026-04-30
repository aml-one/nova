param(
  [string]$NovaPath = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
)

$agentTaskName = "Nova Agent Core"
$webTaskName = "Nova Web UI"

$agentAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -Command `"Set-Location '$NovaPath\apps\agent-core'; node dist/index.js`""
$webAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -Command `"Set-Location '$NovaPath'; corepack pnpm --filter @nova/web start -- -p 3000`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $agentTaskName -Action $agentAction -Trigger $trigger -Principal $principal -Force | Out-Null
Register-ScheduledTask -TaskName $webTaskName -Action $webAction -Trigger $trigger -Principal $principal -Force | Out-Null

Write-Host "Installed startup tasks:"
Write-Host " - $agentTaskName"
Write-Host " - $webTaskName"
Write-Host "Use Task Scheduler to review and run once for verification."
