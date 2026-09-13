#!/usr/bin/env bash
# OS-1F real-Sandbox testbed - verifies the Sandbox credential works and
# prints ONLY safe metadata. Never echoes the token.
#
# Credential input (never as a CLI argument you'd see echoed by this
# script - `oc` itself still receives it as its own argument, which is an
# inherent, unavoidable property of `oc login`'s own CLI design, visible
# only to local `ps` on this same machine during the brief login call):
#   OPENSHIFT_LOGIN_COMMAND   - the full "oc login --token=... --server=..." string, OR
#   OPENSHIFT_API_SERVER + OPENSHIFT_TOKEN
#
# A token pasted directly into THIS conversation, or displayed in any
# prior screenshot/log, must be treated as already-exposed - use a fresh
# one.
set -euo pipefail

if ! command -v oc >/dev/null 2>&1; then
  echo "oc CLI not found on this machine - install it first (test-administration tooling only, never a Log Explorer product dependency)." >&2
  exit 1
fi

if [ -n "${OPENSHIFT_LOGIN_COMMAND:-}" ]; then
  # shellcheck disable=SC2086
  eval "${OPENSHIFT_LOGIN_COMMAND}" >/dev/null
elif [ -n "${OPENSHIFT_API_SERVER:-}" ] && [ -n "${OPENSHIFT_TOKEN:-}" ]; then
  oc login --token="${OPENSHIFT_TOKEN}" --server="${OPENSHIFT_API_SERVER}" >/dev/null
else
  echo "No credential provided. Set OPENSHIFT_LOGIN_COMMAND, or OPENSHIFT_API_SERVER + OPENSHIFT_TOKEN, as environment variables (never paste a token into a chat/document)." >&2
  exit 1
fi

echo "SANDBOX_CLUSTER=$(oc whoami --show-server)"
echo "SANDBOX_USER=$(oc whoami)"
echo "SANDBOX_PROJECT=$(oc project -q 2>/dev/null || echo 'none-selected')"
echo "---- quota (safe, non-secret) ----"
oc get resourcequota -o custom-columns='NAME:.metadata.name,USED:.status.used,HARD:.status.hard' 2>/dev/null || echo "no ResourceQuota object visible (may be enforced cluster-side without a visible object, or none set)"
echo "---- current limits ----"
oc get limitrange -o custom-columns='NAME:.metadata.name' 2>/dev/null || true

# Unset local shell copies of the credential so they don't linger in
# this script's own process environment any longer than necessary. Does
# NOT affect the caller's shell.
unset OPENSHIFT_TOKEN OPENSHIFT_LOGIN_COMMAND 2>/dev/null || true
