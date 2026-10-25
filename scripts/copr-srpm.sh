#!/usr/bin/env bash
# Build a COPR source RPM for TunL (T41): the code (Source0) and the vendored
# dependencies (Source1), so COPR can rebuild it offline in a second chroot.
set -euo pipefail

# COPR does not guarantee the current directory: work from the repository root,
# found from this script's own location.
repo_root="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
cd "$repo_root"

# Require an output directory.
if [ "$#" -lt 1 ] || [ -z "${1:-}" ]; then
  echo "usage: $0 <outdir>" >&2
  exit 1
fi
outdir="$1"
mkdir -p "$outdir"

# In root, install the tools COPR's first chroot may lack; otherwise stop,
# naming the missing one.
tools=(git cargo npm rpmbuild xz)
missing=()
for tool in "${tools[@]}"; do
  command -v "$tool" >/dev/null 2>&1 || missing+=("$tool")
done
if [ "${#missing[@]}" -gt 0 ]; then
  if [ "$(id -u)" -eq 0 ]; then
    dnf -y install "${missing[@]}"
  else
    echo "copr-srpm.sh: missing tool(s): ${missing[*]}" >&2
    exit 1
  fi
fi

version="$(node -p 'require("./package.json").version')"

# Source0: the code at the current commit, prefixed tunl-<version>/.
git archive --prefix "tunl-${version}/" -o "${outdir}/tunl-${version}.tar.gz" HEAD

# Source1: the vendored crates, the npm cache and the cargo config, in a temp
# dir removed on exit. No node_modules ships in the archive.
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Cargo vendor: the crates under vendor/ and the config (stdout). Run from the
# temp dir with the manifest path, so vendor/ lands here and the repo is
# untouched. The config's "directory = vendor" is relative to the .cargo/ dir.
( cd "$tmp" \
  && cargo vendor --locked --manifest-path "${repo_root}/src-tauri/Cargo.toml" \
       > .cargo-config.toml )
mkdir -p "$tmp/.cargo"
mv "$tmp/.cargo-config.toml" "$tmp/.cargo/config.toml"

# npm cache: populate it from package.json and package-lock.json (no node_modules
# ships). A complete ci on the same lockfile is what makes --offline work later.
mkdir -p "$tmp/npm-workspace"
cp package.json package-lock.json "$tmp/npm-workspace/"
( cd "$tmp/npm-workspace" && npm ci --ignore-scripts --cache "$tmp/npm-cache" )

tar -C "$tmp" -cJf "${outdir}/tunl-${version}-vendor.tar.xz" vendor .cargo npm-cache

# Build the source RPM into outdir.
rpmbuild -bs \
  --define "_sourcedir ${outdir}" \
  --define "_srcrpmdir ${outdir}" \
  packaging/rpm/tunl.spec
