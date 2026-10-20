#!/usr/bin/env bash
# TunL RDP test servers (lot 5 review): one direct, one hidden behind the SSH test bastion.
# Needs the SSH environment first (`npm run test-env:up`): it reuses its networks and its bastion.
# Idempotent: recreates both containers. Not part of `npm run review` (manual RDP tests only).
set -euo pipefail
cd "$(dirname "$0")" || exit 1

IMAGE="localhost/tunl-test-xrdp:1"
RDP="tunl-test-rdp"
RDP_HIDDEN="tunl-test-rdp-hidden"
BASTION="tunl-test-bastion"
PUBLIC_NET="tunl-test-public"
INTERNAL_NET="tunl-test-internal"
PORT="${TUNL_RDP_PORT:-3389}"

if ! command -v podman >/dev/null 2>&1; then
  printf 'error: podman is not installed\n' >&2
  exit 1
fi
for net in "$PUBLIC_NET" "$INTERNAL_NET"; do
  if ! podman network exists "$net"; then
    printf 'error: network %s is missing: run `npm run test-env:up` first\n' "$net" >&2
    exit 1
  fi
done

podman build -q -t "$IMAGE" rdp

podman rm -f "$RDP" "$RDP_HIDDEN" >/dev/null 2>&1 || true
podman run -d --name "$RDP" --hostname rdp \
  --network "$PUBLIC_NET" \
  -p "127.0.0.1:$PORT:3389" \
  "$IMAGE"
podman run -d --name "$RDP_HIDDEN" --hostname rdp-hidden \
  --network "$INTERNAL_NET" --network-alias rdp-hidden \
  "$IMAGE"

# Wait for both to answer (up to 15 s): the direct one from here, the hidden one from the bastion.
wait_for() {
  local desc="$1"
  shift
  local i
  for ((i = 0; i < 30; i++)); do
    if "$@" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  printf 'error: %s did not come up in 15 s\n' "$desc" >&2
  return 1
}
wait_for "rdp" bash -c "exec 3<>/dev/tcp/127.0.0.1/$PORT"
wait_for "rdp-hidden (from the bastion)" podman exec "$BASTION" bash -c 'exec 3<>/dev/tcp/rdp-hidden/3389'

cat <<EOF

RDP test servers are up:
  rdp         127.0.0.1:$PORT   $RDP          (direct)
  rdp-hidden  rdp-hidden:3389  $RDP_HIDDEN   (internal only: jump host = the bastion, 127.0.0.1:2223)
user tunl / tunl-password. The certificate is self-signed: accept it on first connection.
EOF
