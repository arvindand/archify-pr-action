#!/usr/bin/env bash
set -euo pipefail
# Pinned archify version: tag v3.0.1. Update SHA + tag together, then verify the fixture semantic contract and determinism.
ARCHIFY_SHA="2ab3cae7ac2c2a55d7386ca789d03c4fcd31816c"
DEST="${1:-.archify-vendor}"
rm -rf "$DEST"
mkdir -p "$DEST"
curl -fsSL "https://codeload.github.com/tt-a1i/archify/tar.gz/${ARCHIFY_SHA}" \
  | tar -xz -C "$DEST" --strip-components=2 "archify-${ARCHIFY_SHA}/archify"
echo "archify vendored at ${DEST} (pinned ${ARCHIFY_SHA})"
