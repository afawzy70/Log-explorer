#!/usr/bin/env bash
#
# Legacy Remediation Slice 9 §O (capability matrix PKG-03) - the receiving
# half of export-image.sh. Loads a tarball produced by that script back
# into the local Docker image store on a machine with no registry access.
#
# Usage: ./scripts/import-image.sh <tarball>
#   ./scripts/import-image.sh log-explorer.tar.gz

set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <tarball produced by export-image.sh>" >&2
  exit 1
fi

TARBALL="$1"
if [ ! -f "$TARBALL" ]; then
  echo "File not found: $TARBALL" >&2
  exit 1
fi

echo "Loading $TARBALL ..."
gunzip -c "$TARBALL" | docker load
echo "Done. Run with: docker compose --profile demo up (see docs/RUN_GUIDE.md for the full Quick Start)."
