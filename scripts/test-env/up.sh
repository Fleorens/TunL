#!/usr/bin/env bash
# TunL SSH test environment (T16): target, bastion and a hidden host on podman.
# Idempotent: safe to run after a previous `up.sh` or `down.sh`.
set -euo pipefail
cd "$(dirname "$0")" || exit 1

IMAGE="localhost/tunl-test-sshd:1"
TARGET="tunl-test-target"
BASTION="tunl-test-bastion"
HIDDEN="tunl-test-hidden"
PUBLIC_NET="tunl-test-public"
INTERNAL_NET="tunl-test-internal"
STATE="$PWD/.state"

# 1. Prerequisites (clear message, non-zero exit).
for cmd in podman ssh-keygen; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    printf 'error: %s is not installed\n' "$cmd" >&2
    exit 1
  fi
done

# 2. Build the image.
podman build -q -t "$IMAGE" .

# 3. State: client keys, host keys, authorized_keys (keys are generated once).
mkdir -p "$STATE/keys" "$STATE/hosts/target" "$STATE/hosts/bastion" "$STATE/hosts/hidden"

[[ -f "$STATE/keys/id_ed25519" ]] || ssh-keygen -q -t ed25519 -N '' -f "$STATE/keys/id_ed25519"
[[ -f "$STATE/keys/id_ed25519_passphrase" ]] \
  || ssh-keygen -q -t ed25519 -N 'tunl-passphrase' -f "$STATE/keys/id_ed25519_passphrase"
[[ -f "$STATE/keys/id_rsa" ]] || ssh-keygen -q -t rsa -b 3072 -N '' -f "$STATE/keys/id_rsa"

for host in target bastion hidden; do
  [[ -f "$STATE/hosts/$host/ssh_host_ed25519_key" ]] \
    || ssh-keygen -q -t ed25519 -N '' -f "$STATE/hosts/$host/ssh_host_ed25519_key"
done

# The three client public keys are accepted on every server.
cat "$STATE/keys/id_ed25519.pub" "$STATE/keys/id_ed25519_passphrase.pub" "$STATE/keys/id_rsa.pub" \
  > "$STATE/authorized_keys"
for host in target bastion hidden; do
  cp "$STATE/authorized_keys" "$STATE/hosts/$host/authorized_keys"
  chmod 0644 "$STATE/hosts/$host/authorized_keys"
done

# 4. Networks (create the ones that are missing).
create_network() {
  if podman network exists "$1"; then
    return 0
  fi
  if [[ "$2" == "internal" ]]; then
    podman network create --internal "$1"
  else
    podman network create "$1"
  fi
}
create_network "$PUBLIC_NET" bridge
create_network "$INTERNAL_NET" internal

# 5. Recreate the three containers.
podman rm -f "$TARGET" "$BASTION" "$HIDDEN" >/dev/null 2>&1 || true

podman run -d --name "$TARGET" --hostname target \
  --network "$PUBLIC_NET" \
  -p 127.0.0.1:2222:22 \
  -v "$STATE/hosts/target:/etc/ssh/tunl:ro,Z" \
  "$IMAGE"

podman run -d --name "$BASTION" --hostname bastion \
  --network "$PUBLIC_NET" --network "$INTERNAL_NET" \
  -p 127.0.0.1:2223:22 \
  -v "$STATE/hosts/bastion:/etc/ssh/tunl:ro,Z" \
  "$IMAGE"

podman run -d --name "$HIDDEN" --hostname hidden \
  --network "$INTERNAL_NET" --network-alias hidden \
  -v "$STATE/hosts/hidden:/etc/ssh/tunl:ro,Z" \
  "$IMAGE"

# 6. Wait for each server to answer (up to 15 s).
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
wait_for "target"  ssh-keyscan -t ed25519 -p 2222 127.0.0.1
wait_for "bastion" ssh-keyscan -t ed25519 -p 2223 127.0.0.1
wait_for "hidden"  podman exec "$BASTION" bash -c 'exec 3<>/dev/tcp/hidden/22'

# 7. known_hosts, ssh_config (absolute paths), env.json — written once, kept
#    across plain `up.sh` runs so a rotated host key stays visible to the client.
if [[ ! -f "$STATE/known_hosts" ]]; then
  {
    ssh-keyscan -t ed25519 -p 2222 127.0.0.1
    ssh-keyscan -t ed25519 -p 2223 127.0.0.1
    podman exec "$BASTION" ssh-keyscan -t ed25519 hidden
  } >"$STATE/known_hosts"
fi

if [[ ! -f "$STATE/ssh_config" ]]; then
  cat >"$STATE/ssh_config" <<EOF
Host tunl-target
  HostName 127.0.0.1
  Port 2222
  IdentityFile $STATE/keys/id_ed25519
Host tunl-target-rsa
  HostName 127.0.0.1
  Port 2222
  IdentityFile $STATE/keys/id_rsa
Host tunl-target-passphrase
  HostName 127.0.0.1
  Port 2222
  IdentityFile $STATE/keys/id_ed25519_passphrase
Host tunl-bastion
  HostName 127.0.0.1
  Port 2223
  IdentityFile $STATE/keys/id_ed25519
Host hidden
  ProxyJump tunl-bastion
  IdentityFile $STATE/keys/id_ed25519
Host *
  User tunl
  UserKnownHostsFile $STATE/known_hosts
  StrictHostKeyChecking yes
  BatchMode yes
  IdentitiesOnly yes
  ConnectTimeout 5
EOF
fi

if [[ ! -f "$STATE/env.json" ]]; then
  fp() { ssh-keygen -lf "$1" | awk '{print $2}'; }
  cat >"$STATE/env.json" <<EOF
{
  "user": "tunl",
  "password": "tunl-password",
  "passphrase": "tunl-passphrase",
  "target": { "host": "127.0.0.1", "port": 2222 },
  "bastion": { "host": "127.0.0.1", "port": 2223 },
  "hidden": { "host": "hidden", "port": 22 },
  "keys": { "ed25519": "$(realpath "$STATE/keys/id_ed25519")", "ed25519Passphrase": "$(realpath "$STATE/keys/id_ed25519_passphrase")", "rsa": "$(realpath "$STATE/keys/id_rsa")" },
  "knownHosts": "$(realpath "$STATE/known_hosts")",
  "hostKeys": { "target": "$(fp "$STATE/hosts/target/ssh_host_ed25519_key.pub")", "bastion": "$(fp "$STATE/hosts/bastion/ssh_host_ed25519_key.pub")", "hidden": "$(fp "$STATE/hosts/hidden/ssh_host_ed25519_key.pub")" }
}
EOF
fi

# 8. Summary.
cat <<'EOF'

SSH test environment is up:
  target   127.0.0.1:2222  tunl-test-target   (public)
  bastion  127.0.0.1:2223  tunl-test-bastion  (public + internal)
  hidden           -     tunl-test-hidden     (internal only, reachable via the bastion)
user tunl / tunl-password. Verify with: npm run test-env:check
EOF
