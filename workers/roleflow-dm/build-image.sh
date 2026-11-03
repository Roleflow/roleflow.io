#!/bin/sh
# Builds the pinned outreacher image for both amd64 and arm64.
set -eu
VERSION="${1:-dev}"
ROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"
exec docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --build-arg IMAGE_VERSION="$VERSION" \
  -f "$ROOT/workers/roleflow-dm/Dockerfile" \
  -t "roleflow-outreacher:${VERSION}" \
  "$ROOT"
