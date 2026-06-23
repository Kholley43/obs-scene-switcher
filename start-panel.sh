#!/usr/bin/env bash
# Start the web control panel (OBS must be running)
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=ensure-deps.sh
source ./ensure-deps.sh
ensure_deps

if [[ ! -f config.json ]]; then
  echo "No config.json — copy config.example.json first."
  exit 1
fi

port=$(node -pe "JSON.parse(require('fs').readFileSync('config.json','utf8')).panelPort||8765")

echo "Opening OBS Scene Switcher panel on port ${port}..."
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://127.0.0.1:${port}" >/dev/null 2>&1 || true
fi

exec node bin/panel-server.mjs --port "${port}"
