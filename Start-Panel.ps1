# Start the web control panel (OBS must be running)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path "config.json")) {
    Write-Host "No config.json — copy config.example.json first." -ForegroundColor Yellow
    exit 1
}

$cfg = Get-Content "config.json" -Raw | ConvertFrom-Json
$port = if ($cfg.panelPort) { [int]$cfg.panelPort } else { 8765 }

Write-Host "Opening OBS Scene Switcher panel on port $port..." -ForegroundColor Cyan
Start-Process "http://127.0.0.1:$port"
node bin\panel-server.mjs --port $port
