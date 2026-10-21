#!/usr/bin/env bash
# Regenerate the Flatpak offline sources (T38): cargo-sources.json and node-sources.json,
# from Cargo.lock and package-lock.json, inside a disposable podman container (nothing to
# install on the host). Re-run after any change to a lockfile.
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1

command -v podman >/dev/null 2>&1 || { printf 'error: podman is not installed\n' >&2; exit 1; }

image="localhost/tunl-flatpak-sources:1"
if ! podman image exists "$image"; then
  printf '%s\n' \
    'FROM docker.io/library/debian:13' \
    'RUN apt-get update && apt-get install -y --no-install-recommends git python3 python3-aiohttp python3-toml python3-tomlkit python3-yaml pipx && rm -rf /var/lib/apt/lists/*' |
    podman build -q -t "$image" -f - . >/dev/null
fi

# The repo is mounted read-write at /work; the two generators read the lockfiles there and
# write the sources back to packaging/flatpak/. flatpak-builder-tools is pinned, not master.
podman run --rm \
  -v "$PWD:/work:rw,Z" \
  "$image" bash -c '
    set -euo pipefail
    git clone --quiet https://github.com/flatpak/flatpak-builder-tools.git /fp-tools
    cd /fp-tools
    git fetch --depth 1 origin 74697c75b630d7330e77250fc13cb5ea688d9479
    git checkout --quiet 74697c75b630d7330e77250fc13cb5ea688d9479
    pipx install ./node
    # pipx puts the wrapper in ~/.local/bin, off a non-interactive shell PATH.
    export PATH="$HOME/.local/bin:$PATH"
    cd /work
    python3 /fp-tools/cargo/flatpak-cargo-generator.py src-tauri/Cargo.lock -o packaging/flatpak/cargo-sources.json
    flatpak-node-generator npm package-lock.json -o packaging/flatpak/node-sources.json
  '

printf 'flatpak sources: cargo-sources.json and node-sources.json regenerated\n'
