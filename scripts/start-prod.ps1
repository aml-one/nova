Write-Host "Starting Nova in production mode..."

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")

$agent = Start-Process powershell -PassThru -ArgumentList @(
  "-NoProfile",
  "-Command",
  "Set-Location '$Root\apps\agent-core'; node dist/index.js"
)

$port = if ($env:NOVA_WEB_PORT) { $env:NOVA_WEB_PORT } else { "3000" }
$web = Start-Process powershell -PassThru -ArgumentList @(
  "-NoProfile",
  "-Command",
  "Set-Location '$Root'; `$env:NOVA_WEB_PORT='$port'; corepack pnpm --filter @nova/web start -- -p $port"
)

Write-Host "Nova started: agent-core PID=$($agent.Id) web PID=$($web.Id)"
Write-Host "Close these windows or stop tasks to terminate services."
