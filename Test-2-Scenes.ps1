# Quick live test — switches between 2 OBS scenes (edit config.2-scenes.example.json first).
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error 'Node.js 18+ required: https://nodejs.org/'
}

if (-not (Test-Path .\config.json)) {
  Write-Host 'No config.json — copying config.2-scenes.example.json'
  Copy-Item .\config.2-scenes.example.json .\config.json
  Write-Host ''
  Write-Host 'IMPORTANT: Edit config.json — set obsScene to your EXACT two OBS scene names.'
  Write-Host '  Run:  node bin\obs-scene.mjs list'
  Write-Host '  Then: notepad config.json'
  Write-Host ''
  Read-Host 'Press Enter after you updated config.json'
}

Write-Host '=== Step 1: list OBS scenes ==='
node bin\obs-scene.mjs list
Write-Host ''

Write-Host '=== Step 2: validate config matches OBS ==='
node bin\obs-scene.mjs validate
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host ''

Write-Host '=== Step 3: goto ONE ==='
node bin\obs-scene.mjs goto ONE
Start-Sleep -Seconds 2

Write-Host '=== Step 4: goto TWO ==='
node bin\obs-scene.mjs goto TWO
Start-Sleep -Seconds 2

Write-Host '=== Step 5: next (should wrap ONE <-> TWO) ==='
node bin\obs-scene.mjs next
Start-Sleep -Seconds 2
node bin\obs-scene.mjs next
Write-Host ''

Write-Host '=== Step 6: auto-rotate 10s (Ctrl+C to stop) ==='
Write-Host 'Watch OBS — scenes should flip every 10 seconds.'
node bin\obs-scene.mjs rotate --interval 10
