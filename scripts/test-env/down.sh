#!/usr/bin/env bash
# Stop the TunL SSH test environment (T16). `--purge` also removes .state/ and the image.
set -euo pipefail
cd "$(dirname "$0")" || exit 1

STATE="$PWD/.state"
IMAGE="localhost/tunl-test-sshd:1"

purge=0
[[ "${1:-}" == "--purge" ]] && purge=1

for c in tunl-test-target tunl-test-bastion tunl-test-hidden tunl-test-rdp tunl-test-rdp-hidden; do
  podman rm -f "$c" >/dev/null 2>&1 || true
done

for n in tunl-test-public tunl-test-internal; do
  podman network rm "$n" >/dev/null 2>&1 || true
done

if ((purge)); then
  rm -rf "$STATE"
  podman rmi -f "$IMAGE" localhost/tunl-test-xrdp:1 >/dev/null 2>&1 || true
  printf 'purged containers, networks, image and .state/\n'
else
  printf 'stopped the tunl-test containers and networks (image and .state/ kept). Use --purge to remove everything.\n'
fi
