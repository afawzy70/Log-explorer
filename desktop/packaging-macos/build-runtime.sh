#!/usr/bin/env bash
# REL-1 (mirrors desktop/packaging/build-runtime.ps1 exactly, adapted to
# bash for macOS): builds a custom, minimal Java runtime (jlink) bundled
# into the macOS .app via jpackage's --runtime-image, so end users need
# no separately-installed Java. Module list is *detected* from the real
# backend jar via jdeps (extracted first - jdeps against a Spring Boot
# repackaged jar directly under-reports the module set, the same finding
# the Windows build-runtime.ps1 documents), plus jdk.crypto.ec (reflective
# TLS cipher-suite provider loading, never a static bytecode reference)
# and java.desktop (needed by the launcher itself - AWT/SystemTray/Desktop
# - not by the backend jar jdeps analyzes, since the launcher and backend
# share this one bundled runtime on macOS; see desktop/launcher-macos).
#
# Usage:
#   desktop/packaging-macos/build-runtime.sh <jar-path> <output-dir>
set -euo pipefail

JAR_PATH="${1:?Usage: build-runtime.sh <jar-path> <output-dir>}"
OUTPUT_DIR="${2:?Usage: build-runtime.sh <jar-path> <output-dir>}"

if [ ! -f "$JAR_PATH" ]; then
  echo "Backend jar not found at '$JAR_PATH' - build it first (mvnw package)." >&2
  exit 1
fi
JAR_PATH="$(cd "$(dirname "$JAR_PATH")" && pwd)/$(basename "$JAR_PATH")"

rm -rf "$OUTPUT_DIR"

EXTRACT_DIR="$(mktemp -d /tmp/logexplorer-jar-extract-XXXXXX)"
trap 'rm -rf "$EXTRACT_DIR"' EXIT

echo "Extracting $JAR_PATH for full-visibility jdeps analysis..."
unzip -q "$JAR_PATH" -d "$EXTRACT_DIR"

CLASSES_DIR="$EXTRACT_DIR/BOOT-INF/classes"
LIB_DIR="$EXTRACT_DIR/BOOT-INF/lib"
if [ ! -d "$CLASSES_DIR" ]; then
  echo "Expected $CLASSES_DIR after extraction - is this a normal Spring Boot repackaged jar?" >&2
  exit 1
fi
if [ ! -d "$LIB_DIR" ]; then
  echo "Expected $LIB_DIR after extraction - is this a normal Spring Boot repackaged jar?" >&2
  exit 1
fi

echo "Detecting required modules via jdeps (classes + full nested-lib classpath)..."
DEPS_OUTPUT="$(jdeps --multi-release 21 --ignore-missing-deps --print-module-deps \
  --class-path "$LIB_DIR/*" \
  "$CLASSES_DIR")"

# jdeps prints a single comma-separated line of module names as its last
# non-empty line - any earlier lines are diagnostic noise.
MODULE_LINE="$(echo "$DEPS_OUTPUT" | grep -E '^[a-zA-Z0-9_.]+(,[a-zA-Z0-9_.]+)*$' | tail -n1 || true)"
if [ -z "$MODULE_LINE" ]; then
  echo "Could not parse a module list from jdeps output:" >&2
  echo "$DEPS_OUTPUT" >&2
  exit 1
fi

MODULES="${MODULE_LINE},jdk.crypto.ec,java.desktop"
echo "Detected modules: $MODULES"

echo "Running jlink..."
jlink \
  --add-modules "$MODULES" \
  --output "$OUTPUT_DIR" \
  --strip-debug \
  --no-header-files \
  --no-man-pages \
  --compress=2

JAVA_BIN="$OUTPUT_DIR/bin/java"
if [ ! -f "$JAVA_BIN" ]; then
  echo "jlink completed but $JAVA_BIN was not produced" >&2
  exit 1
fi

echo "Custom runtime built at $OUTPUT_DIR"
SIZE_MB=$(du -sm "$OUTPUT_DIR" | cut -f1)
echo "Runtime size: ${SIZE_MB} MB"
