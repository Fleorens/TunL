# T16 — Environnement de test SSH (podman : cible, bastion, hôte caché)

| | |
|---|---|
| **Jalon** | M2 — SSH |
| **Dépend de** | T05b (indépendante du reste du lot : peut passer à tout moment) |
| **Lire avant** | `docs/07-dev.md` §5 |
| **Livrable** | `scripts/test-env/` (image, `up.sh`, `down.sh`, `rotate-host-key.sh`), trois scripts npm, `check.sh` vert |

## Pourquoi

Les fiches T17 à T26 écrivent le client SSH de TunL (russh). Elles ont besoin de vrais serveurs, jetables et identiques
chez tout le monde : un serveur **cible** joignable directement, un **bastion**, et un **hôte caché** que seul le
bastion peut joindre. Chaque méthode d'authentification doit y marcher (mot de passe, clé, clé avec passphrase,
keyboard-interactive), et on doit pouvoir **changer une clé d'hôte** pour tester le refus d'une clé modifiée (S6).

Tout ce qui suit a été prototypé par l'orchestrateur sur le poste de Florian (podman 5.8 sans root, image `debian:13`
déjà présente) : les commandes et fichiers donnés ici marchent tels quels.

## Contrat

### Constantes

| Élément | Valeur |
|---|---|
| Image | `localhost/tunl-test-sshd:1`, construite depuis `scripts/test-env/Containerfile` |
| Conteneurs | `tunl-test-target`, `tunl-test-bastion`, `tunl-test-hidden` (nom d'hôte : `target`, `bastion`, `hidden`) |
| Réseaux | `tunl-test-public` (pont) et `tunl-test-internal` (`--internal`, sans accès extérieur) |
| Ports publiés | cible `127.0.0.1:2222`, bastion `127.0.0.1:2223` ; l'hôte caché n'en publie aucun |
| Réseaux par conteneur | cible : public ; bastion : public + interne ; caché : interne seulement, alias `hidden` |
| Utilisateur | `tunl`, mot de passe `tunl-password` ; passphrase de la clé protégée : `tunl-passphrase` |

Ce sont des secrets **de test**, publics, qui n'ouvrent que des conteneurs locaux : ils peuvent être écrits en clair.

### `scripts/test-env/Containerfile` (tel quel)

```dockerfile
FROM docker.io/library/debian:13
ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssh-server \
 && rm -rf /var/lib/apt/lists/* /etc/ssh/ssh_host_* \
 && mkdir -p /run/sshd \
 && useradd --create-home --shell /bin/bash tunl \
 && echo 'tunl:tunl-password' | chpasswd
COPY sshd_config /etc/ssh/sshd_config.d/tunl.conf
CMD ["/usr/sbin/sshd", "-D", "-e"]
```

### `scripts/test-env/sshd_config` (tel quel)

```
HostKey /etc/ssh/tunl/ssh_host_ed25519_key
AuthorizedKeysFile /etc/ssh/tunl/authorized_keys
PasswordAuthentication yes
KbdInteractiveAuthentication yes
PermitRootLogin no
AllowTcpForwarding yes
LogLevel VERBOSE
```

Debian active PAM : `KbdInteractiveAuthentication yes` donne un vrai keyboard-interactive (PAM demande « Password: »).

### L'état : `scripts/test-env/.state/` (ignoré par git)

```
.state/
├── hosts/{target,bastion,hidden}/   ssh_host_ed25519_key(.pub) et authorized_keys (0644), montés en
│                                    /etc/ssh/tunl dans le conteneur (`-v …:/etc/ssh/tunl:ro,Z`)
├── keys/                            id_ed25519, id_ed25519_passphrase, id_rsa (3072 bits), et leurs .pub
├── authorized_keys                  les trois clés publiques
├── known_hosts                      [127.0.0.1]:2222, [127.0.0.1]:2223 et hidden, avec leurs clés d'hôte
├── ssh_config                       voir ci-dessous
└── env.json                         voir ci-dessous (lu par les tests Rust du lot 4)
```

Clés d'hôte et clés clientes : générées **une seule fois** (`ssh-keygen -q -N … -f …`), gardées d'un `up.sh` à
l'autre, pour que `known_hosts` reste valable.

`ssh_config` (chemins **absolus**) :

```
Host tunl-target
  HostName 127.0.0.1
  Port 2222
  IdentityFile <state>/keys/id_ed25519
Host tunl-target-rsa
  HostName 127.0.0.1
  Port 2222
  IdentityFile <state>/keys/id_rsa
Host tunl-target-passphrase
  HostName 127.0.0.1
  Port 2222
  IdentityFile <state>/keys/id_ed25519_passphrase
Host tunl-bastion
  HostName 127.0.0.1
  Port 2223
  IdentityFile <state>/keys/id_ed25519
Host hidden
  ProxyJump tunl-bastion
  IdentityFile <state>/keys/id_ed25519
Host *
  User tunl
  UserKnownHostsFile <state>/known_hosts
  StrictHostKeyChecking yes
  BatchMode yes
  IdentitiesOnly yes
  ConnectTimeout 5
```

⚠ Piège vu au prototype : les options `-o` de la ligne de commande **ne passent pas** au saut d'un `ProxyJump`. Le
saut ne lit que le fichier de config : c'est pourquoi tout est dans `ssh_config`, `Host *` compris.

`env.json` :

```json
{
  "user": "tunl",
  "password": "tunl-password",
  "passphrase": "tunl-passphrase",
  "target": { "host": "127.0.0.1", "port": 2222 },
  "bastion": { "host": "127.0.0.1", "port": 2223 },
  "hidden": { "host": "hidden", "port": 22 },
  "keys": { "ed25519": "<abs>", "ed25519Passphrase": "<abs>", "rsa": "<abs>" },
  "knownHosts": "<abs>",
  "hostKeys": { "target": "SHA256:…", "bastion": "SHA256:…", "hidden": "SHA256:…" }
}
```

`hostKeys` : l'empreinte donnée par `ssh-keygen -lf <clé>.pub` (deuxième champ).

### Scripts (bash, `set -euo pipefail`, exécutables)

- **`up.sh`** : idempotent. Vérifie que `podman` et `ssh-keygen` existent (sinon message clair, code 1). Construit
  l'image (`podman build -q -t … scripts/test-env`), crée l'état manquant, crée les réseaux absents
  (`podman network exists` d'abord), recrée les trois conteneurs (`podman rm -f`, puis `podman run -d --name …
  --hostname … --network …`), attend que chaque serveur réponde (au plus 15 s : `ssh-keyscan` pour la cible et le
  bastion, et pour l'hôte caché `podman exec tunl-test-bastion bash -c '</dev/tcp/hidden/22'`), écrit `known_hosts`,
  `ssh_config` et `env.json`, puis affiche un résumé (ports, utilisateur, `npm run test-env:check`).
- **`down.sh`** : supprime les conteneurs et les réseaux. `down.sh --purge` supprime aussi `.state/` et l'image.
- **`rotate-host-key.sh <target|bastion|hidden>`** : régénère la clé d'hôte de ce serveur et redémarre son conteneur
  (`podman restart`), **sans** toucher à `known_hosts` ni à `env.json` : la prochaine connexion doit voir une clé
  modifiée. Affiche la nouvelle empreinte. Argument invalide → usage, code 2.

### Le reste

- `package.json` : `"test-env:up": "scripts/test-env/up.sh"`, `"test-env:down": "scripts/test-env/down.sh"`,
  `"test-env:check": "scripts/test-env/check.sh"`.
- `.gitignore` : `scripts/test-env/.state/`.
- `docs/07-dev.md` §5 : remplacer le paragraphe par l'usage réel (les trois commandes npm, les deux ports, l'hôte
  caché, `rotate-host-key.sh`, et `env.json` pour les tests Rust), en dix lignes au plus.
- Rien dans `npm run review` : l'environnement demande podman, et la CI (T37) décidera plus tard.

## Tests du contrat

### `scripts/test-env/check.sh`

```bash
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
```

## Étapes

1. Le test : `node scripts/contract-tests.mjs T16`, puis `chmod +x scripts/test-env/check.sh`.
2. `Containerfile` et `sshd_config` tels quels, puis `up.sh`. `npm run test-env:up` doit finir sans erreur.
3. `npm run test-env:check` jusqu'à `all checks passed`.
4. `rotate-host-key.sh`, puis vérifier à la main : `scripts/test-env/rotate-host-key.sh target`, puis
   `ssh -F scripts/test-env/.state/ssh_config tunl-target true` doit **échouer** (clé modifiée). `up.sh` ne répare pas
   ça tout seul : `down.sh --purge` puis `up.sh` repart de zéro (et `check.sh` repasse au vert).
5. `down.sh`, puis `up.sh` une deuxième fois : les clés sont gardées, `check.sh` reste vert sans rien régénérer.
6. `package.json`, `.gitignore`, `docs/07-dev.md` §5. `npm run review` (rien ne doit avoir bougé), cases, statut,
   commit `chore: podman SSH test environment (T16)`.

## Critères d'acceptation

- [ ] `npm run test-env:up` puis `npm run test-env:check` : `all checks passed` (20 lignes `ok`).
- [ ] `node scripts/contract-tests.mjs T16 --check` affiche `OK`.
- [ ] Après `rotate-host-key.sh target`, la connexion à `tunl-target` échoue avec « REMOTE HOST IDENTIFICATION HAS CHANGED ».
- [ ] `down.sh --purge` ne laisse ni conteneur, ni réseau, ni image `tunl-test-*` (`podman ps -a`, `podman network ls`,
      `podman images`).
- [ ] `git status` ne montre rien de `.state/`.

## À regarder par Florian

`npm run test-env:up`, puis `ssh -F scripts/test-env/.state/ssh_config hidden` : tu arrives sur l'hôte caché en
passant par le bastion. `npm run test-env:down` pour tout arrêter.
