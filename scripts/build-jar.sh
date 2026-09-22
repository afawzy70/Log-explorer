#!/usr/bin/env bash
#
# MISSION=PR61_DEFAULT_LOG_LEVELS_SINGLE_JAR_AND_USAGE_DOCS - produces ONE runnable Spring Boot jar
# containing the compiled production frontend and the backend, so `java -jar log-explorer-<version>.jar`
# is the complete application. Java is the only runtime prerequisite; Node/npm are needed here, at build
# time, never afterward.
#
# This reuses the exact "frontend dist -> Spring Boot static resources -> mvnw package" pattern already
# proven by Dockerfile, scripts/build-desktop-windows.ps1 and scripts/build-desktop-macos.sh - none of
# those three publish the plain jar as its own deliverable, each only ever consumes it further (a
# container layer, an installer, a DMG). This script does not touch pom.xml's build config or any of
# those three existing, working, CI-verified pipelines: backend/target/'s own default jar name
# (log-explorer-backend-<version>.jar, and its non-runnable *.jar.original sibling) is exactly what they
# already depend on - only this script's own OUTPUT copy is renamed to the clearer log-explorer-<version>.jar.
#
# Usage: scripts/build-jar.sh [output-dir]
#   output-dir defaults to ./dist-jar (created if missing)
#
# Exit code 0 = the jar was built and copied to <output-dir>. The path is also printed as the script's
# last line of output, on its own, for easy capture by a caller (e.g. JAR="$(scripts/build-jar.sh)").

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="${1:-$REPO_ROOT/dist-jar}"
STATIC_DIR="$REPO_ROOT/backend/src/main/resources/static"

cleanup() {
  # Never leaves the source tree holding a build artifact - src/main/resources/static/ is not
  # gitignored by name (it simply never exists in source control at all), so a stray copy left behind
  # here would otherwise silently pollute `git status` and risk being committed by accident.
  rm -rf "$STATIC_DIR"
}
trap cleanup EXIT

echo "== [1/3] Building the frontend production bundle ==" >&2
(cd "$REPO_ROOT/frontend" && npm ci && npm run build) >&2

echo "== [2/3] Embedding the frontend into Spring Boot's static resources (fresh copy - no stale assets survive) ==" >&2
rm -rf "$STATIC_DIR"
mkdir -p "$STATIC_DIR"
cp -r "$REPO_ROOT/frontend/dist/." "$STATIC_DIR/"

echo "== [3/3] Building the backend fat jar (clean build) ==" >&2
(cd "$REPO_ROOT/backend" && ./mvnw -B clean package -DskipTests) >&2

# spring-boot-maven-plugin repackages the plain jar into an executable one at the default finalName
# (log-explorer-backend-<version>.jar) and renames the original, non-runnable plain jar alongside it to
# *.jar.original - excluded here so the artifact this script ever hands back is always the runnable one.
JAR="$(find "$REPO_ROOT/backend/target" -maxdepth 1 -name 'log-explorer-backend-*.jar' ! -name '*.original' | head -n1)"
if [ -z "$JAR" ]; then
  echo "ERROR: no runnable jar found under backend/target (expected log-explorer-backend-<version>.jar)" >&2
  exit 1
fi

VERSION="$(basename "$JAR" .jar | sed 's/^log-explorer-backend-//')"
mkdir -p "$OUTPUT_DIR"
DEST="$OUTPUT_DIR/log-explorer-$VERSION.jar"
cp "$JAR" "$DEST"

echo "== Runnable jar ready: $DEST ==" >&2
echo "$DEST"
