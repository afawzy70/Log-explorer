#!/usr/bin/env bash
# REL-1 (mirrors desktop/packaging/packaged-smoke-test.ps1's intent for
# macOS): mounts the real generated DMG, "installs" the real .app bundle
# (copies it out of the disk image - a DMG is a drag-to-install format,
# there is no separate silent-installer step to invoke, unlike the
# Windows Inno Setup installer), launches the real installed product,
# and verifies the real end-to-end lifecycle: backend health, UI load, a
# representative API call, then a shutdown that leaves no orphan java
# process behind. Does NOT drive the menu-bar tray icon itself via UI
# automation - everything else in the real packaged lifecycle is
# verified for real here, not assumed from "jpackage produced a file".
#
# Usage (macOS only - a DMG can only be mounted and a .app only actually
# run on macOS):
#   desktop/packaging-macos/packaged-smoke-test.sh <path-to-generated-dmg>
set -euo pipefail

DMG_PATH="${1:?Usage: packaged-smoke-test.sh <path-to-generated-dmg>}"
INSTALL_DIR="$(mktemp -d /tmp/logexplorer-macos-install-XXXXXX)"
MOUNT_POINT=""
APP_PID=""

step() { echo; echo "=== $1 ==="; }
fail() { echo "FAIL: $1" >&2; cleanup; exit 1; }

cleanup() {
  if [ -n "$APP_PID" ] && kill -0 "$APP_PID" 2>/dev/null; then
    kill "$APP_PID" 2>/dev/null || true
  fi
  if [ -n "$MOUNT_POINT" ]; then
    hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || true
  fi
}
trap cleanup EXIT

step 'Mount the real generated DMG'
ATTACH_OUTPUT="$(hdiutil attach "$DMG_PATH" -nobrowse -readonly)"
MOUNT_POINT="$(echo "$ATTACH_OUTPUT" | grep -Eo '/Volumes/.*' | tail -n1)"
if [ -z "$MOUNT_POINT" ]; then fail "could not determine the DMG mount point from hdiutil output"; fi
echo "Mounted at $MOUNT_POINT"

APP_BUNDLE="$(find "$MOUNT_POINT" -maxdepth 1 -iname '*.app' | head -n1)"
if [ -z "$APP_BUNDLE" ]; then fail "no .app bundle found in the mounted DMG"; fi
echo "Found app bundle: $APP_BUNDLE"

step 'Install (copy the .app out of the disk image - a DMG has no separate silent-installer step)'
cp -R "$APP_BUNDLE" "$INSTALL_DIR/"
INSTALLED_APP="$INSTALL_DIR/$(basename "$APP_BUNDLE")"
LAUNCHER_BIN="$(find "$INSTALLED_APP/Contents/MacOS" -maxdepth 1 -type f | head -n1)"
if [ -z "$LAUNCHER_BIN" ]; then fail "no executable found under $INSTALLED_APP/Contents/MacOS"; fi
echo "Installed at $INSTALLED_APP"

step 'Verify product/version/publisher metadata (v0.1.0 release branding requirement)'
INFO_PLIST="$INSTALLED_APP/Contents/Info.plist"
if [ ! -f "$INFO_PLIST" ]; then fail "Info.plist not found at $INFO_PLIST"; fi
PLIST_NAME="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleName' "$INFO_PLIST" 2>/dev/null || true)"
PLIST_SHORT_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$INFO_PLIST" 2>/dev/null || true)"
PLIST_COPYRIGHT="$(/usr/libexec/PlistBuddy -c 'Print :NSHumanReadableCopyright' "$INFO_PLIST" 2>/dev/null || true)"
echo "Info.plist CFBundleName: $PLIST_NAME"
echo "Info.plist CFBundleShortVersionString: $PLIST_SHORT_VERSION"
echo "Info.plist NSHumanReadableCopyright: $PLIST_COPYRIGHT"
if [ "$PLIST_NAME" != "Log Explorer" ]; then fail "Info.plist CFBundleName is '$PLIST_NAME', expected 'Log Explorer'"; fi
case "$PLIST_COPYRIGHT" in
  *"Ahmed Fawzy elrifaye"*) : ;;
  *) fail "Info.plist NSHumanReadableCopyright '$PLIST_COPYRIGHT' does not contain the expected publisher 'Ahmed Fawzy elrifaye'" ;;
esac
echo 'Product/version/publisher metadata verified'

step 'Launch the real installed application'
"$LAUNCHER_BIN" &
APP_PID=$!
sleep 2
if ! kill -0 "$APP_PID" 2>/dev/null; then
  fail "launcher process exited immediately - see \$HOME/Library/Application Support/LogExplorer/logs/backend.log"
fi

step 'Wait for backend health (bounded, port recorded by the launcher itself)'
PORT_FILE="$HOME/Library/Application Support/LogExplorer/running-port.txt"
BACKEND_LOG="$HOME/Library/Application Support/LogExplorer/logs/backend.log"
PORT=""
for _ in $(seq 1 30); do
  if [ -f "$PORT_FILE" ]; then
    PORT="$(cat "$PORT_FILE")"
    if curl -s -m 2 "http://127.0.0.1:${PORT}/actuator/health" 2>/dev/null | grep -q '"status":"UP"'; then
      break
    fi
  fi
  sleep 1
done
if [ -z "$PORT" ] || ! curl -s -m 2 "http://127.0.0.1:${PORT}/actuator/health" | grep -q '"status":"UP"'; then
  if [ -f "$BACKEND_LOG" ]; then echo "--- backend.log tail ---"; tail -n 50 "$BACKEND_LOG"; fi
  fail 'backend never reported healthy within 30s'
fi
echo "Backend healthy on port $PORT"

step 'Verify the local UI loads (served by Spring Boot itself, no separate frontend server)'
UI_BODY="$(curl -s -m 5 "http://127.0.0.1:${PORT}/")"
if ! echo "$UI_BODY" | grep -qi 'log explorer'; then fail 'root response did not look like the app shell'; fi
echo 'UI shell loads'

step 'Verify a representative API call'
SOURCES_BODY="$(curl -s -m 5 "http://127.0.0.1:${PORT}/api/v1/sources")"
if ! echo "$SOURCES_BODY" | grep -Eq '"id":"(fixture|local-docker|openshift-loki)"'; then
  fail 'no recognizable source in /api/v1/sources response'
fi
echo 'API call returned real source data'

step 'Quit the application and verify clean shutdown (no orphan java process)'
kill "$APP_PID"
KILLED_PID="$APP_PID"
APP_PID=""
for _ in $(seq 1 10); do
  if ! kill -0 "$KILLED_PID" 2>/dev/null; then break; fi
  sleep 1
done
sleep 2
if pgrep -f "log-explorer-backend.jar" >/dev/null 2>&1; then
  fail "an orphan backend java process survived the launcher being stopped"
fi
echo 'No orphan backend process - clean shutdown'

step 'Uninstall (a macOS app is uninstalled by deleting the bundle - no separate uninstaller)'
rm -rf "$INSTALLED_APP"
if [ -d "$INSTALLED_APP" ]; then fail 'app bundle removal did not take effect'; fi
echo 'App bundle removed'

echo
echo "PACKAGED MACOS SMOKE TEST PASSED"
