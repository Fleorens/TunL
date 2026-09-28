#!/usr/bin/env bash
# Acceptance check of the SSH test environment (T16). Run it after `npm run test-env:up`.
set -uo pipefail
cd "$(dirname "$0")" || exit 1
STATE="$PWD/.state"
CONFIG="$STATE/ssh_config"
failures=0

pass() { printf 'ok    %s\n' "$1"; }
fail() {
  printf 'FAIL  %s\n' "$1"
  failures=$((failures + 1))
}

# expect <name> <text expected in the output> <command...>
expect() {
  local name=$1 expected=$2 out
  shift 2
  if out=$(timeout 30 "$@" 2>&1) && [[ $out == *"$expected"* ]]; then
    pass "$name"
  else
    fail "$name: ${out//$'\n'/ }"
  fi
}

# refuse <name> <command...>: the command must fail
refuse() {
  local name=$1
  shift
  if timeout 30 "$@" >/dev/null 2>&1; then fail "$name: should have failed"; else pass "$name"; fi
}

askpass() {
  local file="$STATE/askpass-$1.sh"
  printf '#!/bin/sh\necho %s\n' "$2" >"$file"
  chmod 700 "$file"
  printf '%s' "$file"
}

for file in ssh_config known_hosts env.json authorized_keys keys/id_ed25519 keys/id_ed25519_passphrase keys/id_rsa; do
  if [[ -f $STATE/$file ]]; then pass "state: $file"; else fail "state: $file missing (run up.sh)"; fi
done

if node -e '
  const env = require(process.argv[1]);
  const keys = ["user", "password", "passphrase", "target", "bastion", "hidden", "keys", "knownHosts", "hostKeys"];
  const missing = keys.filter((key) => !(key in env));
  if (missing.length > 0 || env.target.port !== 2222 || env.bastion.port !== 2223) process.exit(1);
' "$STATE/env.json"; then pass "env.json"; else fail "env.json: missing keys or wrong ports"; fi

run='echo ok-$(hostname)'
expect "key ed25519 -> target" "ok-target" ssh -F "$CONFIG" tunl-target "$run"
expect "key rsa -> target" "ok-target" ssh -F "$CONFIG" tunl-target-rsa "$run"
expect "key -> bastion" "ok-bastion" ssh -F "$CONFIG" tunl-bastion "$run"

password=$(askpass password tunl-password)
wrong=$(askpass wrong not-the-password)
passphrase=$(askpass passphrase tunl-passphrase)
# `timeout` cannot run a shell function: the askpass environment goes through `env`, and `setsid -w` drops the tty.
by_password=(-o BatchMode=no -o PubkeyAuthentication=no -o PreferredAuthentications=password)
by_keyboard=(-o BatchMode=no -o PubkeyAuthentication=no -o PreferredAuthentications=keyboard-interactive)
expect "password -> target" "ok-target" env SSH_ASKPASS="$password" SSH_ASKPASS_REQUIRE=force \
  setsid -w ssh -F "$CONFIG" "${by_password[@]}" tunl-target "$run"
expect "keyboard-interactive -> target" "ok-target" env SSH_ASKPASS="$password" SSH_ASKPASS_REQUIRE=force \
  setsid -w ssh -F "$CONFIG" "${by_keyboard[@]}" tunl-target "$run"
refuse "wrong password is refused" env SSH_ASKPASS="$wrong" SSH_ASKPASS_REQUIRE=force \
  setsid -w ssh -F "$CONFIG" "${by_password[@]}" tunl-target "$run"
expect "key with passphrase -> target" "ok-target" env SSH_ASKPASS="$passphrase" SSH_ASKPASS_REQUIRE=force \
  setsid -w ssh -F "$CONFIG" -o BatchMode=no tunl-target-passphrase "$run"

expect "jump via bastion -> hidden" "ok-hidden" ssh -F "$CONFIG" hidden "$run"
expect "sftp -> target" "/home/tunl" bash -c "echo pwd | sftp -q -F '$CONFIG' tunl-target"

refuse "target cannot reach hidden" podman exec tunl-test-target timeout 3 bash -c '</dev/tcp/hidden/22'
refuse "hidden cannot reach the outside" podman exec tunl-test-hidden timeout 3 bash -c '</dev/tcp/1.1.1.1/53'

scanned=$(ssh-keyscan -t ed25519 -p 2222 127.0.0.1 2>/dev/null | ssh-keygen -lf - 2>/dev/null | awk '{print $2}')
expected=$(node -e 'console.log(require(process.argv[1]).hostKeys.target)' "$STATE/env.json")
if [[ -n $scanned && $scanned == "$expected" ]]; then pass "target host key matches env.json"; else
  fail "target host key: scanned '$scanned', env.json '$expected'"
fi

rm -f "$STATE"/askpass-*.sh
if ((failures > 0)); then
  printf '\n%d check(s) failed\n' "$failures"
  exit 1
fi
printf '\nall checks passed\n'
