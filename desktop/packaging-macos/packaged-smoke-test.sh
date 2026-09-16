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
# Where the launcher tells the backend to persist classification rules
# (AppPaths.DATA_DIRECTORY, passed as LOGEXPLORER_DATA_DIR).
RULES_DATA_DIR="$HOME/Library/Application Support/LogExplorer/data"
# Set once this script has saved any pre-existing rules data aside;
# restore_rules_data puts it back (or removes what the smoke rule created)
# so a developer machine or CI runner is left exactly as it was found.
RULES_BACKUP_DIR=""

step() { echo; echo "=== $1 ==="; }
fail() { echo "FAIL: $1" >&2; cleanup; exit 1; }

restore_rules_data() {
  [ -n "$RULES_BACKUP_DIR" ] || return 0
  for name in classification-rules.json classification-rules.json.bak; do
    if [ -f "$RULES_BACKUP_DIR/$name" ]; then
      cp -p "$RULES_BACKUP_DIR/$name" "$RULES_DATA_DIR/$name" 2>/dev/null || true
    else
      rm -f "$RULES_DATA_DIR/$name"
    fi
  done
  rmdir "$RULES_DATA_DIR" 2>/dev/null || true
  rm -rf "$RULES_BACKUP_DIR"
  RULES_BACKUP_DIR=""
}

cleanup() {
  if [ -n "$APP_PID" ] && kill -0 "$APP_PID" 2>/dev/null; then
    kill "$APP_PID" 2>/dev/null || true
  fi
  if [ -n "$MOUNT_POINT" ]; then
    hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || true
  fi
  restore_rules_data
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

step 'Classification rules persist under ~/Library/Application Support/LogExplorer/data (never inside the app bundle)'
RULES_URL="http://127.0.0.1:${PORT}/api/v1/settings/classification-rules"
# Save any pre-existing rules data aside before the smoke rule touches it.
RULES_BACKUP_DIR="$(mktemp -d /tmp/logexplorer-smoke-rules-XXXXXX)"
for name in classification-rules.json classification-rules.json.bak; do
  if [ -f "$RULES_DATA_DIR/$name" ]; then cp -p "$RULES_DATA_DIR/$name" "$RULES_BACKUP_DIR/"; fi
done

RULES_STATE="$(curl -s -m 10 "$RULES_URL")" || fail "GET $RULES_URL failed"
REVISION="$(printf '%s' "$RULES_STATE" | grep -Eo '"revision":[0-9]+' | head -n1 | cut -d: -f2 || true)"
STORAGE_FILE="$(printf '%s' "$RULES_STATE" | grep -Eo '"storageFile":"[^"]*"' | head -n1 | sed -e 's/^"storageFile":"//' -e 's/"$//' || true)"
if [ -z "$REVISION" ]; then fail 'classification rules response has no revision'; fi
if [ -z "$STORAGE_FILE" ]; then fail 'classification rules response has no storageFile'; fi
echo "Rules storageFile (from the API): $STORAGE_FILE"
case "$STORAGE_FILE" in
  "$RULES_DATA_DIR"/*) : ;;
  *) fail "rules storageFile '$STORAGE_FILE' is not under $RULES_DATA_DIR - the launcher did not pass LOGEXPLORER_DATA_DIR to the backend" ;;
esac
case "$STORAGE_FILE" in
  "$INSTALL_DIR"/*|"/private$INSTALL_DIR"/*|"$INSTALLED_APP"/*)
    fail "rules storageFile '$STORAGE_FILE' is inside the installed app location $INSTALL_DIR - replacing or deleting the bundle would lose the user's rules" ;;
esac

RULE_BODY="{\"expectedRevision\":${REVISION},\"rule\":{\"name\":\"Smoke rule\",\"tags\":[\"smoke\"],\"conditions\":[{\"field\":\"message\",\"matcher\":\"CONTAINS\",\"value\":\"smoke-test-marker\"}]}}"
POST_STATUS="$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d "$RULE_BODY" "$RULES_URL" || true)"
case "$POST_STATUS" in
  2??) : ;;
  *) fail "POST $RULES_URL (create smoke rule) returned HTTP $POST_STATUS, expected 2xx" ;;
esac
if [ ! -f "$STORAGE_FILE" ]; then fail "rules file $STORAGE_FILE does not exist on disk after a successful save"; fi
if ! grep -q 'smoke-test-marker' "$STORAGE_FILE"; then fail "rules file $STORAGE_FILE does not contain the smoke rule after a successful save"; fi
echo "Smoke rule saved to $STORAGE_FILE (outside $INSTALL_DIR)"

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

step 'Classification rules survive uninstall (replacing/deleting the bundle keeps them)'
if [ ! -f "$STORAGE_FILE" ]; then fail "rules file $STORAGE_FILE was removed with the app bundle - rules would not survive an upgrade or reinstall"; fi
if ! grep -q 'smoke-test-marker' "$STORAGE_FILE"; then fail "rules file $STORAGE_FILE no longer contains the smoke rule after uninstall"; fi
echo 'Rules file survived uninstall'

step 'Clean up the smoke rule (restore any pre-existing rules data)'
restore_rules_data
echo "Rules data under $RULES_DATA_DIR restored to its pre-test state"

echo
echo "PACKAGED MACOS SMOKE TEST PASSED"
