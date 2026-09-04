#!/usr/bin/env bash
# Download the pinned renderer if needed and run the real pipeline scenarios.
set -euo pipefail
cd "$(dirname "$0")/../.."
[ -f .archify-vendor/bin/archify.mjs ] || bash scripts/vendor-archify.sh
node scripts/demo-scenarios.mjs "$@"
