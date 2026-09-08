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
set -e

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
