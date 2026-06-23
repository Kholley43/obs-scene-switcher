#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
exec node bin/obs-scene.mjs rotate "$@"
