#!/usr/bin/env bash
# Regenerate the host key of one server (target|bastion|hidden) and restart its container,
# without touching known_hosts or env.json: the next connection sees a changed host key.
set -euo pipefail
cd "$(dirname "$0")" || exit 1

STATE="$PWD/.state"
HOST="${1:-}"

case "$HOST" in
  target|bastion|hidden) ;;
  *)
    printf 'usage: %s <target|bastion|hidden>\n' "$0" >&2
    exit 2
    ;;
esac

KEY="$STATE/hosts/$HOST/ssh_host_ed25519_key"

# Remove the old pair first so ssh-keygen overwrites without prompting.
rm -f "$KEY" "$KEY.pub"
ssh-keygen -q -t ed25519 -N '' -f "$KEY"

podman restart "tunl-test-$HOST"

printf '%s host key changed:\n' "$HOST"
ssh-keygen -lf "$KEY.pub"
