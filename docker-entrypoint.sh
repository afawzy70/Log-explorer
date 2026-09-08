#!/bin/sh
# Phase K: the container image starts as root ONLY so this script can align
# group membership with a bind-mounted host /var/run/docker.sock before
# handing off - it never runs the application itself as root.
#
# Real problem this fixes, found by actually running the `docker-socket`
# profile against this host's real socket (not assumed): the socket is
# owned root:docker, mode 660 - a fixed-UID/GID non-root image user has no
# way to know in advance what GID the *host's* docker group will be on any
# given machine, so it can never be baked into the image. This script
# reads the mounted socket's real GID at container start, creates or
# reuses a matching group, adds the app user to it, then immediately
# drops to that non-root user via su-exec before exec'ing the JVM - the
# actual application process is always non-root, on every profile,
# incl. `docker-socket`.
#
# Phase L addendum, found by actually running this exact image with an
# arbitrary non-root UID (`docker run --user 1000660000:0 ...`) - the same
# way OpenShift's default `restricted` SCC always runs every container,
# never granting real root regardless of what the image's own Dockerfile
# declares: su-exec crashed immediately ("setgroups: Operation not
# permitted"), because a non-root, non-privileged process can't call
# setgroups() at all - this script's whole group-fixup dance assumes it
# is genuinely root to begin with. Under OpenShift there is no
# docker.sock to align with anyway (Docker discovery is Compose-only;
# OpenShift only ever uses the Loki source), so the fix is simply to
# skip straight to running the JVM directly whenever this script is NOT
# actually running as root - correct for OpenShift, and harmless for any
# other non-root invocation of this same image.
set -e

if [ "$(id -u)" != "0" ]; then
  exec java -jar app.jar "$@"
fi

if [ -S /var/run/docker.sock ]; then
  SOCK_GID="$(stat -c '%g' /var/run/docker.sock)"
  if ! getent group "$SOCK_GID" > /dev/null 2>&1; then
    addgroup -g "$SOCK_GID" dockersock
  fi
  GROUP_NAME="$(getent group "$SOCK_GID" | cut -d: -f1)"
  adduser logexplorer "$GROUP_NAME" > /dev/null 2>&1 || true
fi

# Bare username (not "user:group") is deliberate: su-exec only calls
# initgroups() - which is what actually picks up the dockersock
# supplementary-group membership just added above from /etc/group - when
# given a plain username. Passing an explicit "user:group" pair (tried
# first, found wrong by inspecting the running process's real
# /proc/1/status Groups line, which showed only the primary group) skips
# that lookup and sets only the primary GID, silently dropping every
# supplementary group.
exec su-exec logexplorer java -jar app.jar "$@"
