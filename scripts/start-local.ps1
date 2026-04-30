$ErrorActionPreference = "Stop"

$root = Join-Path $PSScriptRoot ".."
$restartDelaySeconds = 2

function Start-NovaProcess {
  param(
    [Parameter(Mandatory = $true)][string]$Filter
  )
  Start-Process powershell `
    -ArgumentList "-NoExit", "-Command", "cd '$root'; corepack pnpm --filter $Filter dev" `
    -PassThru
}

function Stop-NovaProcess {
  param(
    [Parameter(Mandatory = $false)]$Process
  )
  if ($null -eq $Process) { return }
  try {
    if (-not $Process.HasExited) {
      Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
    }
  } catch {
    # Ignore cleanup errors for already-exited children.
  }
}

Write-Host "Starting Nova local stack supervisor (Windows)..."
Write-Host "If agent-core or web exits (including update restarts), both will be relaunched."

$agent = $null
$web = $null

try {
  while ($true) {
    Write-Host "Launching agent-core and web..."
    $agent = Start-NovaProcess -Filter "@nova/agent-core"
    $web = Start-NovaProcess -Filter "@nova/web"

    Write-Host "agent-core PID $($agent.Id), web PID $($web.Id)"

    while ($true) {
      Start-Sleep -Seconds 1
      if ($agent.HasExited) {
        Write-Host "agent-core exited; restarting full stack..."
        break
      }
      if ($web.HasExited) {
        Write-Host "web exited; restarting full stack..."
        break
      }
    }

    Stop-NovaProcess -Process $agent
    Stop-NovaProcess -Process $web
    $agent = $null
    $web = $null
    Start-Sleep -Seconds $restartDelaySeconds
  }
}
finally {
  Write-Host "Stopping Nova local stack..."
  Stop-NovaProcess -Process $agent
  Stop-NovaProcess -Process $web
}
