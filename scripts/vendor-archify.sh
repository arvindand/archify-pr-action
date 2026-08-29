#!/usr/bin/env bash
set -euo pipefail
# Pinned archify version: tag v2.15.0. Update SHA + tag together, then re-run Task 2 fixture capture.
ARCHIFY_SHA="e1ac748f19cf805e44bf74fb93c796662152e273"
DEST="${1:-.archify-vendor}"
rm -rf "$DEST"
mkdir -p "$DEST"
curl -fsSL "https://codeload.github.com/tt-a1i/archify/tar.gz/${ARCHIFY_SHA}" \
  | tar -xz -C "$DEST" --strip-components=2 "archify-${ARCHIFY_SHA}/archify"
echo "archify vendored at ${DEST} (pinned ${ARCHIFY_SHA})"
