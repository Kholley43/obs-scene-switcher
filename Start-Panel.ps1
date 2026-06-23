# Start the web control panel (OBS must be running)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path "config.json")) {
    Write-Host "No config.json — copy config.example.json first." -ForegroundColor Yellow
    exit 1
}

Write-Host "Opening OBS Scene Switcher panel..." -ForegroundColor Cyan
Start-Process "http://127.0.0.1:8765"
node bin\panel-server.mjs
