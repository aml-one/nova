# Framework-dependent single-file Nova Web Shell (win-x64).
# Requires .NET 10 Desktop Runtime on the machine. WebView2 Runtime (Evergreen) required at runtime.
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$proj = Join-Path $root "apps\nova-web-shell\NovaWebShell.csproj"
dotnet publish $proj -p:PublishProfile=WinFrameworkDependentSingleFile
$out = Join-Path $root "apps\nova-web-shell\publish\win-x64-framework-dependent-singlefile\NovaWebShell.exe"
Write-Host "Output: $out"
