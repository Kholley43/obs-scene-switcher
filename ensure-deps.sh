#!/usr/bin/env bash
# Ensure npm `ws` is installed when Node lacks global WebSocket (common on Linux).
ensure_deps() {
  if node -e "if(globalThis.WebSocket)process.exit(0)" 2>/dev/null; then
    return 0
  fi
  if [[ ! -d node_modules/ws ]]; then
    echo "Node has no global WebSocket — running npm install (ws package)..."
    npm install --omit=dev
  fi
}
