$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
node bin\obs-scene.mjs rotate @args
