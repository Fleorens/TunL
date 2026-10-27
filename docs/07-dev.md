# 07 — Environnement de développement

## 1. Prérequis

| Outil | Version | Vérifier |
|---|---|---|
| Node.js | ≥ 22.12 (poste de Florian : 24.14) | `node --version` |
| Rust | ≥ 1.90 via rustup, composants `rustfmt` et `clippy` | `rustc --version && cargo clippy --version` |
| Bibliothèques Tauri | WebKitGTK 4.1 + OpenSSL (en-têtes de dev) | voir ci-dessous |
| FreeRDP 3 (pour tester le RDP) | ≥ 3.0 | `sdl-freerdp --version` ou `sdl-freerdp3 --version` |
| podman (tests d'intégration SSH) | ≥ 5 | `podman --version` |

Paquets système :

```bash
# Fedora
sudo dnf install webkit2gtk4.1-devel openssl-devel gcc freerdp
# Debian 13 / Ubuntu 24.04+
sudo apt install libwebkit2gtk-4.1-dev libssl-dev build-essential curl wget file libxdo-dev \
                 libayatana-appindicator3-dev librsvg2-dev freerdp3-sdl
# Arch
sudo pacman -S --needed webkit2gtk-4.1 base-devel curl wget file openssl libappindicator-gtk3 librsvg freerdp
```

`rustup component add rustfmt clippy` si `cargo fmt` ou `cargo clippy` répond « not installed ».

Poste de Florian (Fedora 44, KDE Plasma Wayland), vérifié le 2026-09-26 : tout est déjà présent, y compris `rustfmt`
et `clippy`. `sudo` demande un mot de passe : **l'agent ne lance jamais `sudo`**. S'il manque un paquet système,
il s'arrête et le signale.

## 2. Scripts npm

| Commande | Effet |
|---|---|
| `npm run dev` | serveur Vite seul (port 1420). Ouvert dans un navigateur, l'app tourne avec l'**IPC simulé** |
| `npm run tauri dev` | app complète (compile le Rust, ouvre la fenêtre) |
| `npm run build` | `tsc -b` puis build Vite dans `dist/` |
| `npm run tauri build` | paquets de release (`.deb`, `.rpm`, AppImage). `-- --no-bundle` pour le binaire seul |
| `npm run typecheck` | `tsc -b` |
| `npm run check` / `npm run format` | Biome : vérifier / corriger |
| `npm run test` | Vitest (une passe) |
| `npm run bindings` | régénère `src/bindings/` depuis les types Rust (`cargo test export_bindings`) |
| `npm run verify:rust` | `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (clippy en `--all-features` à partir de T17b) |
| `npm run test:ssh` | à partir de T17b : `test-env:up`, puis les tests d'intégration SSH (`src-tauri/tests/ssh_*.rs`, feature `test-env`) contre les conteneurs |
| `npm run rules` | règles projet (`scripts/project-rules.mjs`) et tests du contrat de toutes les fiches livrées (`contract-tests.mjs --all`) |
| `npm run verify` | typecheck + check + rules + test + verify:rust |
| `npm run e2e` | scénarios Playwright dans le Chromium du système (`e2e/`), serveur Vite lancé automatiquement (T05b). Un test échoue aussi sur une erreur console (`e2e/support/test.ts`) |
| `npm run review` | **tout** : `verify`, `test:ssh` (à partir de T17b), puis `e2e`. C'est la recette d'une fiche |

## 3. Boucle de travail de l'agent

1. `git status` → propre ?
2. Lire la fiche, coder par petites étapes.
3. Après chaque étape Rust : `cd src-tauri && cargo check` (rapide). Après chaque étape TS : `npm run typecheck`.
4. À la fin : `npm run format`, puis `npm run review` → tout vert.
5. Si la fiche touche l'UI : `npm run tauri dev` pour que Florian regarde. L'agent n'a pas d'accès visuel :
   il **dit** ce qu'il faut regarder.
6. Commit.

## 4. Dépannage

| Symptôme | Cause / remède |
|---|---|
| Fenêtre blanche au lancement (surtout NVIDIA) | `WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri dev` |
| `error TS5101: Option 'baseUrl' is deprecated` | TypeScript 6 : retirer `baseUrl`, garder seulement `paths` |
| Bindings TS en `bigint` | `src-tauri/.cargo/config.toml` doit définir `TS_RS_LARGE_INT = "number"` |
| Bindings générés dans `src-tauri/bindings/` | `TS_RS_EXPORT_DIR` absent de `src-tauri/.cargo/config.toml` |
| `shadcn add` pose une question et bloque | lancer avec `CI=1` et `-y`, et entrée standard fermée : `CI=1 npx shadcn add x -y </dev/null` |
| `npm run e2e` : « Executable doesn't exist » | pas de Chromium système : `export TUNL_CHROMIUM=/chemin/vers/chromium`, ou `npx playwright install chromium` |
| Port 1420 occupé | un ancien `npm run dev` tourne encore : `pkill -f "vite"` |
| Lancé depuis le terminal de VS Code, une app Electron démarre comme Node | variable `ELECTRON_RUN_AS_NODE=1` héritée. Sans effet sur Tauri, mais `env -u ELECTRON_RUN_AS_NODE` en cas de doute |

## 5. Environnement de test SSH (à partir de T16)

Un environnement podman (sans root) fournit, pour T17→T26, un serveur **cible**, un **bastion** et un **hôte caché**
(joignable seulement via le bastion), avec toutes les authentifications (mot de passe, clé, clé avec passphrase,
keyboard-interactive). `podman` et `ssh-keygen` suffisent.

```bash
npm run test-env:up        # construit l'image, recrée les 3 conteneurs, écrit l'état (.state/, ignoré)
npm run test-env:check     # vérifie que tout marche (doit afficher « all checks passed »)
npm run test-env:down      # arrête conteneurs et réseaux (garde l'image et .state/)
```

- Cible `127.0.0.1:2222`, bastion `127.0.0.1:2223` ; l'hôte caché n'en publie aucun. Utilisateur `tunl` / `tunl-password`.
- Changer une clé d'hôte pour tester le refus (S6) : `scripts/test-env/rotate-host-key.sh <target|bastion|hidden>`.
- Tout effacer (conteneurs, réseaux, image, `.state/`) : `npm run test-env:down -- --purge`.
- `scripts/test-env/.state/env.json` (chemins absolus, empreintes des clés d'hôte) est lu par les tests Rust du lot 4.

### Serveurs RDP de test (à la main, hors `npm run review`)

```bash
npm run test-env:up        # d'abord : le RDP réutilise les réseaux et le bastion de l'environnement SSH
npm run test-env:rdp       # construit l'image xrdp (une fois), recrée les 2 conteneurs
```

- `rdp` : `127.0.0.1:3389` en direct (`TUNL_RDP_PORT=… npm run test-env:rdp` si le port est pris).
- `rdp-hidden` : hôte `rdp-hidden`, port 3389, joignable seulement via le bastion (dans TunL : jump host = le bastion
  `127.0.0.1:2223`).
- Utilisateur `tunl` / `tunl-password`, bureau IceWM avec un xterm qui affiche le nom du serveur. Certificat
  auto-signé : FreeRDP demande de l'accepter à la première connexion.
- `npm run test-env:down` les arrête aussi (`--purge` supprime aussi leur image).

## 6. CI et publication (à partir de T37)

- **`.github/workflows/ci.yml`**, à chaque push sur `main` et chaque pull request, trois jobs :
  `npm run review` (Ubuntu 24.04 : bibliothèques Tauri, Chromium de Playwright, podman du runner) ;
  les audits de S16 (`npm audit --omit=dev --audit-level=high` bloquant, `npm audit` complet en avertissement,
  `cargo audit` dans `src-tauri`) ; `scripts/check-packaging.sh` (entrée de bureau et metainfo, T36).
- **`.github/workflows/release.yml`**, sur un tag `vX.Y.Z` : vérifie que le tag est la version de l'app
  (`node scripts/check-version.mjs vX.Y.Z` : `package.json`, `tauri.conf.json`, `Cargo.toml`, metainfo), construit le
  `.deb`, le `.rpm` et l'AppImage sur Ubuntu 22.04, et les joint avec `SHA256SUMS` à une publication GitHub
  **brouillon**. La publier est une décision humaine (liste de T40).
- **Copr** (`strelok/tunl`, Fedora 43 et 44, T41) : pas de webhook, la construction se lance à la main à chaque
  version, une fois le tag poussé sur GitHub. Avant le tag, monter `Version:` et ajouter une entrée `%changelog` dans
  la spec : `check-version.mjs` ne la vérifie pas. Puis, depuis un poste connecté à Copr (`kinit <compte>@FEDORAPROJECT.ORG`) :
  `copr-cli buildscm strelok/tunl --clone-url https://github.com/Fleorens/TunL.git --commit vX.Y.Z --method make_srpm`.
  Copr prépare le SRPM (`.copr/Makefile` → `scripts/copr-srpm.sh`, sur une machine qui peut être aarch64 : le cache
  npm embarqué couvre donc x64 et arm64), puis construit le RPM hors ligne (`packaging/rpm/tunl.spec`), en
  40 minutes environ. Journaux : `https://download.copr.fedorainfracloud.org/results/strelok/tunl/<chroot>/<build>-tunl/`.
- Les actions sont **épinglées par commit**, leur version en commentaire. Pour en monter une :
  `git ls-remote https://github.com/<action> 'refs/tags/<tag>^{}'`, puis remplacer le SHA et le commentaire.
- `cargo audit` lit `src-tauri/.cargo/audit.toml` : chaque avis ignoré y dit pourquoi, et se relit à chaque
  publication (T40). Aujourd'hui : RUSTSEC-2023-0071 (`rsa`, attaque Marvin sur le déchiffrement ; TunL ne fait que
  signer).
- En local : `cargo install cargo-audit --locked` une fois, puis `cd src-tauri && cargo audit`.
