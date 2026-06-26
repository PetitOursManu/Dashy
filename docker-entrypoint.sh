#!/bin/sh
set -e

# If the host's Docker socket is mounted in, the runtime `node` user must belong
# to the group that owns it so the Store's "direct Docker" driver can use it.
# The socket's GID differs per host (0 on Docker Desktop, the `docker` group on a
# typical Linux host), so we detect it at runtime and join `node` to that group.
if [ -S /var/run/docker.sock ]; then
  SOCK_GID="$(stat -c '%g' /var/run/docker.sock 2>/dev/null || echo '')"
  if [ -n "$SOCK_GID" ]; then
    if ! getent group "$SOCK_GID" >/dev/null 2>&1; then
      groupadd -g "$SOCK_GID" dockerhost 2>/dev/null || true
    fi
    GROUP_NAME="$(getent group "$SOCK_GID" | cut -d: -f1)"
    if [ -n "$GROUP_NAME" ]; then
      usermod -aG "$GROUP_NAME" node 2>/dev/null || true
    fi
  fi
fi

# Drop from root to the unprivileged `node` user for the actual server process.
exec gosu node "$@"
