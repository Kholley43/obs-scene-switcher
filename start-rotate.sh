#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=ensure-deps.sh
source ./ensure-deps.sh
ensure_deps
exec node bin/obs-scene.mjs rotate "$@"
