#!/usr/bin/env bash
# Validate the desktop entry and the AppStream metainfo with the freedesktop tools (T36).
# Uses `desktop-file-validate` and `appstreamcli` when installed (CI), else a throwaway podman container.
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
# The template as Tauri fills it for the deb and rpm packages.
sed -e 's/{{exec}}/tunl/' -e 's/{{icon}}/tunl/' -e 's/{{comment}}/SSH, SFTP and RDP connections/' \
  packaging/linux/tunl.desktop.hbs >"$work/tunl.desktop"
cp packaging/linux/io.github.fleorens.TunL.metainfo.xml "$work/"

run() {
  desktop-file-validate /work/tunl.desktop
  appstreamcli validate --no-net --explain /work/io.github.fleorens.TunL.metainfo.xml
}

if command -v desktop-file-validate >/dev/null && command -v appstreamcli >/dev/null; then
  desktop-file-validate "$work/tunl.desktop"
  appstreamcli validate --no-net --explain "$work/io.github.fleorens.TunL.metainfo.xml"
elif command -v podman >/dev/null; then
  image="localhost/tunl-check-packaging:1"
  if ! podman image exists "$image"; then
    printf 'FROM docker.io/library/debian:13\nRUN apt-get update && apt-get install -y --no-install-recommends appstream desktop-file-utils && rm -rf /var/lib/apt/lists/*\n' |
      podman build -q -t "$image" -f - . >/dev/null
  fi
  podman run --rm -v "$work:/work:ro,Z" "$image" bash -c "$(declare -f run); run"
else
  printf 'error: install desktop-file-utils and appstream, or podman\n' >&2
  exit 1
fi
printf 'packaging: desktop entry and metainfo are valid\n'
