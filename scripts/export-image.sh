#!/usr/bin/env bash
#
# Legacy Remediation Slice 9 §O (capability matrix PKG-03, reconciled from
# the legacy app's own PORTABLE_COMPOSE_RUNBOOK.md §2): saves the built
# Log Explorer image as a single compressed tarball, for moving it to a
# machine with no registry access (a genuinely offline/air-gapped
# environment) - the primary portable-distribution path stays `docker
# compose --profile demo up --build` (docs/RUN_GUIDE.md); this is only
# for that offline case. Never bakes in a .env or any secret - only the
# image layers themselves.
#
# Usage: ./scripts/export-image.sh [output-file] [image-tag]
#   ./scripts/export-image.sh                     # -> log-explorer.tar.gz, tag log-explorer:local
#   ./scripts/export-image.sh out.tar.gz my:tag

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

OUTPUT_FILE="${1:-log-explorer.tar.gz}"
IMAGE_TAG="${2:-log-explorer:local}"

if ! docker image inspect "$IMAGE_TAG" > /dev/null 2>&1; then
  echo "Image '$IMAGE_TAG' not found locally - build it first, e.g.:" >&2
  echo "  docker compose build" >&2
  exit 1
fi

echo "Saving $IMAGE_TAG -> $OUTPUT_FILE ..."
docker save "$IMAGE_TAG" | gzip > "$OUTPUT_FILE"
echo "Wrote $OUTPUT_FILE ($(du -h "$OUTPUT_FILE" | cut -f1))"
echo "On the target machine: ./scripts/import-image.sh $OUTPUT_FILE"
