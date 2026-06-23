#!/usr/bin/env bash
# Quick environment check — run before first use on Linux.
set -euo pipefail
cd "$(dirname "$0")"

echo "=== OBS Scene Switcher — setup check ==="
echo ""

echo "Node version:"
node -v || { echo "FAIL: node not found — install Node 18.18+ from https://nodejs.org/"; exit 1; }

echo ""
echo "Node path:"
which node || true

echo ""
echo "WebSocket (global):"
node -e "console.log('  globalThis.WebSocket:', !!globalThis.WebSocket)"

if ! node -e "if(!globalThis.WebSocket) process.exit(1)" 2>/dev/null; then
  echo "  (global missing — will use npm ws package after npm install)"
  if [[ ! -d node_modules/ws ]]; then
    echo ""
    echo "Installing dependencies (ws package)..."
    npm install
  fi
fi

echo ""
echo "WebSocket (via obs-scene-switcher):"
node -e "
import { webSocketAvailable } from './lib/websocket.mjs';
import { resolveWebSocket } from './lib/websocket.mjs';
const r = resolveWebSocket();
console.log('  OK — using', r.kind);
" || { echo "FAIL: run npm install in this folder"; exit 1; }

echo ""
if [[ ! -f config.json ]]; then
  echo "config.json: MISSING — run: cp config.example.json config.json"
else
  echo "config.json: OK"
fi

echo ""
echo "OBS WebSocket test (OBS must be running):"
if node bin/obs-scene.mjs list 2>&1; then
  echo ""
  echo "=== All good — run ./start-panel.sh ==="
else
  echo ""
  echo "Could not reach OBS — enable Tools → WebSocket Server Settings in OBS, then retry."
  exit 1
fi
