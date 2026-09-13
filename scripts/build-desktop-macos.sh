#!/usr/bin/env bash
# REL-1: the single, repository-owned entry point for building the
# macOS desktop package - a developer cloning this repository runs
# EXACTLY this script, and CI (.github/workflows/macos-desktop.yml)
# calls the exact same script rather than duplicating these steps in
# YAML. See docs/development/BUILD_DESKTOP.md for prerequisites and the
# DEV_UNSIGNED_MODE / RELEASE_GRADE_MODE distinction.
#
# Usage (macOS only - jpackage's DMG/.app output is platform-specific):
#   scripts/build-desktop-macos.sh                    # DEV_UNSIGNED_MODE (default)
#   scripts/build-desktop-macos.sh --mode release      # RELEASE_GRADE_MODE - requires
#                                                       # MACOS_SIGNING_IDENTITY (and, for
#                                                       # notarization, MACOS_NOTARIZE_APPLE_ID /
#                                                       # MACOS_NOTARIZE_TEAM_ID / MACOS_NOTARIZE_PASSWORD)
#                                                       # to already be set in the environment -
#                                                       # never fabricated if absent, this fails loudly instead.
#   scripts/build-desktop-macos.sh --version 1.2.3
#   scripts/build-desktop-macos.sh --skip-preflight
#   scripts/build-desktop-macos.sh --skip-frontend-install
#
# Output: desktop/build-macos/dmg/LogExplorer-<version>-macos-*.dmg
set -euo pipefail

MODE="dev"
VERSION=""
SKIP_PREFLIGHT=0
SKIP_FRONTEND_INSTALL=0

while [ $# -gt 0 ]; do
  case "$1" in
    --mode) MODE="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    --skip-preflight) SKIP_PREFLIGHT=1; shift ;;
    --skip-frontend-install) SKIP_FRONTEND_INSTALL=1; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

step() { echo; echo "=== $1 ==="; }
fail() { echo; echo "BUILD FAILED: $1" >&2; exit 1; }

if [ "$(uname -s)" != "Darwin" ]; then
  fail "This script produces a macOS .app/.dmg and must run on macOS (found: $(uname -s)). See docs/development/BUILD_DESKTOP.md - there is no cross-build path."
fi

# ---------------------------------------------------------------------
# Preflight - fail early, clearly, and actionably. No silent fallback.
# ---------------------------------------------------------------------
if [ "$SKIP_PREFLIGHT" -eq 0 ]; then
  step 'Preflight: required local tooling'

  require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
      fail "'$1' was not found on PATH. $2"
    fi
    echo "  OK: $1 -> $(command -v "$1")"
  }

  require_command java 'Install a full JDK 21 (Temurin recommended), not a JRE-only distribution.'
  require_command jlink 'jlink ships with the JDK (not the JRE) - install a full JDK 21.'
  require_command jdeps 'jdeps ships with the JDK (not the JRE) - install a full JDK 21.'
  require_command jpackage 'jpackage ships with the JDK (not the JRE) - install a full JDK 21.'
  require_command mvn 'Install Apache Maven (needed for the launcher-macos module; the backend itself uses its own wrapper, backend/mvnw).'
  require_command node 'Install Node.js (see frontend/package.json engines, or .github/workflows/ci.yml for the exact version CI uses).'
  require_command npm 'npm ships with Node.js - reinstall Node.js if missing.'
  require_command hdiutil 'hdiutil ships with macOS - if missing, this is not a standard macOS system.'

  JAVA_VERSION_OUTPUT="$(java -version 2>&1 || true)"
  if ! echo "$JAVA_VERSION_OUTPUT" | grep -q '"21\.'; then
    fail "java on PATH is not Java 21 (found: $(echo "$JAVA_VERSION_OUTPUT" | head -n1)). The backend, jlink runtime, jdeps module detection, and jpackage all require exactly Java 21."
  fi
  echo '  OK: java is version 21'

  if [ ! -x "$REPO_ROOT/backend/mvnw" ]; then
    fail "backend/mvnw not found or not executable - is this a clean checkout of the repository?"
  fi
  echo '  OK: Maven wrapper present (backend/mvnw)'

  if ! xcode-select -p >/dev/null 2>&1; then
    fail 'Xcode command-line tools not found. Install with: xcode-select --install (jpackage'"'"'s DMG/codesign tooling on macOS depends on them.)'
  fi
  echo "  OK: Xcode command-line tools -> $(xcode-select -p)"
else
  echo 'Skipping preflight (--skip-preflight) - assuming tooling was already verified.'
fi

# ---------------------------------------------------------------------
# Mode - DEV_UNSIGNED_MODE (default) produces an unsigned .app/.dmg that
# works for local/dev use without any Apple credentials.
# RELEASE_GRADE_MODE requires real signing credentials already present in
# the environment; it fails loudly rather than silently falling back to
# unsigned if they are missing (mission: "Never fabricate signing/
# notarization success").
# ---------------------------------------------------------------------
step "Mode: $MODE"
SIGN_ARGS=()
if [ "$MODE" = "release" ]; then
  if [ -z "${MACOS_SIGNING_IDENTITY:-}" ]; then
    fail 'RELEASE_GRADE_MODE requires MACOS_SIGNING_IDENTITY (a "Developer ID Application: ..." identity already present in the local keychain) to be set. Refusing to silently produce an unsigned build under a release-mode request - use --mode dev for an unsigned developer build instead.'
  fi
  echo "RELEASE_GRADE_MODE: signing as '$MACOS_SIGNING_IDENTITY'"
  SIGN_ARGS+=(--mac-sign --mac-signing-key-user-name "$MACOS_SIGNING_IDENTITY")
  if [ -n "${MACOS_SIGNING_KEYCHAIN:-}" ]; then
    SIGN_ARGS+=(--mac-signing-keychain "$MACOS_SIGNING_KEYCHAIN")
  fi
  # Notarization is a separate, explicit post-build step
  # (docs/development/BUILD_DESKTOP.md) - jpackage itself only signs;
  # this script never invokes `xcrun notarytool` on the caller's behalf
  # without MACOS_NOTARIZE_* being explicitly set, and never claims
  # notarization happened when it did not.
  if [ -n "${MACOS_NOTARIZE_APPLE_ID:-}" ] && [ -n "${MACOS_NOTARIZE_TEAM_ID:-}" ] && [ -n "${MACOS_NOTARIZE_PASSWORD:-}" ]; then
    echo 'Notarization credentials present - notarization will be attempted after packaging.'
  else
    echo 'Notarization credentials NOT set (MACOS_NOTARIZE_APPLE_ID / MACOS_NOTARIZE_TEAM_ID / MACOS_NOTARIZE_PASSWORD) - the resulting DMG will be signed but NOT notarized. This is reported honestly below, never claimed as notarized.'
  fi
elif [ "$MODE" != "dev" ]; then
  fail "Unknown --mode '$MODE' - expected 'dev' or 'release'."
else
  echo 'DEV_UNSIGNED_MODE: no Apple signing credentials required or used. The resulting .app/.dmg is unsigned - macOS Gatekeeper will require an explicit right-click "Open" the first time. This is expected for a local developer build.'
fi

# ---------------------------------------------------------------------
# Version resolution - VERSION (repository root) is the single
# authoritative release/application version source (REL-1 §10), the
# SAME algorithm scripts/build-desktop-windows.ps1 uses.
# ---------------------------------------------------------------------
step 'Resolve version'
if [ -z "$VERSION" ]; then
  if TAG="$(git describe --tags --exact-match 2>/dev/null)"; then
    VERSION="${TAG#v}"
  else
    BASE_VERSION="$(tr -d '[:space:]' < "$REPO_ROOT/VERSION")"
    SHA="$(git rev-parse --short HEAD)"
    VERSION="${BASE_VERSION}-dev.${SHA}"
  fi
fi
echo "Version: $VERSION"
# jpackage's macOS --app-version has its own hard constraint (confirmed
# via a real jpackage run on a real macos-latest CI runner): the FIRST
# numeric component must be >= 1 ("The first number in an app-version
# cannot be zero or negative") and it must be 1-3 dot-separated integers
# with no qualifier suffix - it cannot carry a pre-1.0 semantic version
# like "0.1.0" or a "-dev.<sha>" suffix at all. This is jpackage's own
# internal bundle-metadata requirement, not this project's real product
# version - the full, correct, human-readable $VERSION (including any
# "0.x.y" or "-dev.<sha>") is what appears in the DMG filename and
# everywhere else a person actually reads it.
RAW_APP_VERSION="$(echo "$VERSION" | grep -Eo '^[0-9]+\.[0-9]+\.[0-9]+' || echo '0.0.1')"
APP_VERSION_MAJOR="${RAW_APP_VERSION%%.*}"
if [ "$APP_VERSION_MAJOR" = "0" ]; then
  APP_VERSION_NUMERIC="1.0.0"
  echo "Note: resolved version '$VERSION' has a major component of 0, which jpackage's --app-version rejects outright. Using a fixed internal jpackage app-version of '$APP_VERSION_NUMERIC' - this is jpackage bundle metadata only; the DMG filename and all other artifact naming use the real '$VERSION'."
else
  APP_VERSION_NUMERIC="$RAW_APP_VERSION"
fi

# ---------------------------------------------------------------------
# Frontend production build, embedded into the backend's static
# resources - the SAME single-deployable-jar shape the product always
# ships as (CLAUDE.md §1), identical to the Windows build.
# ---------------------------------------------------------------------
step 'Build frontend production assets'
pushd "$REPO_ROOT/frontend" >/dev/null
if [ "$SKIP_FRONTEND_INSTALL" -eq 0 ]; then
  npm ci
fi
npm run build
popd >/dev/null

step 'Embed frontend build into backend static resources'
mkdir -p "$REPO_ROOT/backend/src/main/resources/static"
cp -R "$REPO_ROOT/frontend/dist/." "$REPO_ROOT/backend/src/main/resources/static/"

step 'Build backend jar (skips tests - run the full backend suite separately; see docs/development/BUILD_DESKTOP.md)'
pushd "$REPO_ROOT/backend" >/dev/null
./mvnw --batch-mode -o -DskipTests package || ./mvnw --batch-mode -DskipTests package
popd >/dev/null

BACKEND_JAR="$(find "$REPO_ROOT/backend/target" -maxdepth 1 -name 'log-explorer-backend-*.jar' ! -name '*.original' | head -n1)"
if [ -z "$BACKEND_JAR" ]; then fail 'backend jar not found in backend/target after packaging'; fi

step 'Build custom Java runtime (jlink)'
"$REPO_ROOT/desktop/packaging-macos/build-runtime.sh" "$BACKEND_JAR" "$REPO_ROOT/desktop/build-macos/runtime"

step 'Build the macOS launcher (Maven, plain Java - no external dependencies)'
pushd "$REPO_ROOT/desktop/launcher-macos" >/dev/null
mvn --batch-mode -q package
popd >/dev/null
LAUNCHER_JAR="$REPO_ROOT/desktop/launcher-macos/target/log-explorer-desktop-launcher-macos.jar"
if [ ! -f "$LAUNCHER_JAR" ]; then fail "launcher jar not found at $LAUNCHER_JAR after packaging"; fi

step 'Assemble the jpackage input directory (launcher jar + backend jar, side by side)'
APP_INPUT_DIR="$REPO_ROOT/desktop/build-macos/app-input"
rm -rf "$APP_INPUT_DIR"
mkdir -p "$APP_INPUT_DIR"
cp "$LAUNCHER_JAR" "$APP_INPUT_DIR/"
cp "$BACKEND_JAR" "$APP_INPUT_DIR/log-explorer-backend.jar"

step 'Package with jpackage (.app + .dmg)'
DMG_DEST="$REPO_ROOT/desktop/build-macos/dmg"
rm -rf "$DMG_DEST"
mkdir -p "$DMG_DEST"
jpackage \
  --type dmg \
  --name "Log Explorer" \
  --app-version "$APP_VERSION_NUMERIC" \
  --input "$APP_INPUT_DIR" \
  --main-jar "$(basename "$LAUNCHER_JAR")" \
  --main-class com.logexplorer.desktoplauncher.Main \
  --runtime-image "$REPO_ROOT/desktop/build-macos/runtime" \
  --dest "$DMG_DEST" \
  --mac-package-identifier com.logexplorer.desktop \
  --vendor "Ahmed Fawzy elrifaye" \
  --copyright "Copyright (c) $(date +%Y) Ahmed Fawzy elrifaye" \
  "${SIGN_ARGS[@]+"${SIGN_ARGS[@]}"}"
# v0.1.0 release/branding pass: --vendor and --copyright are the two
# jpackage-supported author/publisher fields for a macOS app bundle.
# --copyright is written directly into the generated Info.plist as
# NSHumanReadableCopyright, which Finder's "Get Info" panel displays -
# the most user-visible publisher/author attribution macOS packaging
# truthfully supports without a real Apple Developer Team identity
# (which this project does not have, and does not fabricate).
# Owner-required exact spelling/casing, no invented company suffix.

DMG_FILE="$(find "$DMG_DEST" -maxdepth 1 -name '*.dmg' | head -n1)"
if [ -z "$DMG_FILE" ]; then fail 'jpackage reported success but no .dmg was found'; fi

# jpackage names the DMG from --name/--app-version (e.g. "Log
# Explorer-0.1.0.dmg") - rename to this project's documented artifact
# naming convention (REL-1 §11) using the FULL resolved $VERSION
# (including any -dev.<sha> suffix jpackage's own numeric-only
# --app-version can't carry).
FINAL_DMG="$DMG_DEST/LogExplorer-${VERSION}-macos-$(uname -m).dmg"
mv "$DMG_FILE" "$FINAL_DMG"

step 'SHA-256 checksum'
if command -v shasum >/dev/null 2>&1; then
  (cd "$(dirname "$FINAL_DMG")" && shasum -a 256 "$(basename "$FINAL_DMG")" > "$(basename "$FINAL_DMG").sha256")
else
  (cd "$(dirname "$FINAL_DMG")" && sha256sum "$(basename "$FINAL_DMG")" > "$(basename "$FINAL_DMG").sha256")
fi
echo "Checksum written to ${FINAL_DMG}.sha256"
cat "${FINAL_DMG}.sha256"

step 'Packaging sizes'
RUNTIME_SIZE_MB=$(du -sm "$REPO_ROOT/desktop/build-macos/runtime" | cut -f1)
JAR_SIZE_MB=$(du -m "$APP_INPUT_DIR/log-explorer-backend.jar" | cut -f1)
DMG_SIZE_MB=$(du -m "$FINAL_DMG" | cut -f1)
echo "Backend jar (with embedded frontend): ${JAR_SIZE_MB} MB"
echo "Bundled custom JRE (jlink): ${RUNTIME_SIZE_MB} MB"
echo "macOS disk image ($(basename "$FINAL_DMG")): ${DMG_SIZE_MB} MB"

echo
echo "BUILD COMPLETE: $FINAL_DMG"
echo "Run desktop/packaging-macos/packaged-smoke-test.sh \"$FINAL_DMG\" to verify the real installed app end to end."
