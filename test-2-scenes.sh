#!/usr/bin/env bash
# Quick live test — switches between 2 OBS scenes (edit config first).
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18+ required: https://nodejs.org/" >&2
  exit 1
fi

if [[ ! -f config.json ]]; then
  echo "No config.json — copying config.2-scenes.example.json"
  cp config.2-scenes.example.json config.json
  echo ""
  echo "IMPORTANT: Edit config.json — set obsScene to your EXACT two OBS scene names."
  echo "  Run:  node bin/obs-scene.mjs list"
  echo "  Then: nano config.json   (or your editor)"
  echo ""
  read -r -p "Press Enter after you updated config.json"
fi

echo "=== Step 1: list OBS scenes ==="
node bin/obs-scene.mjs list
echo ""

echo "=== Step 2: validate config matches OBS ==="
node bin/obs-scene.mjs validate
echo ""

echo "=== Step 3: goto ONE ==="
node bin/obs-scene.mjs goto ONE
sleep 2

echo "=== Step 4: goto TWO ==="
node bin/obs-scene.mjs goto TWO
sleep 2

echo "=== Step 5: next (should wrap ONE <-> TWO) ==="
node bin/obs-scene.mjs next
sleep 2
node bin/obs-scene.mjs next
echo ""

echo "=== Step 6: auto-rotate 10s (Ctrl+C to stop) ==="
echo "Watch OBS — scenes should flip every 10 seconds."
exec node bin/obs-scene.mjs rotate --interval 10
