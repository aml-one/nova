Write-Host "Starting Nova agent-core and web..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\..'; corepack pnpm --filter @nova/agent-core dev"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\..'; corepack pnpm --filter @nova/web dev"
Write-Host "Agent core and web started in separate terminals."
