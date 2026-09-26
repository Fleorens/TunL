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
| `npm run verify:rust` | `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` |
| `npm run verify` | **tout** : typecheck + check + test + verify:rust |

## 3. Boucle de travail de l'agent

1. `git status` → propre ?
2. Lire la fiche, coder par petites étapes.
3. Après chaque étape Rust : `cd src-tauri && cargo check` (rapide). Après chaque étape TS : `npm run typecheck`.
4. À la fin : `npm run format`, puis `npm run verify` → tout vert.
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
| Port 1420 occupé | un ancien `npm run dev` tourne encore : `pkill -f "vite"` |
| Lancé depuis le terminal de VS Code, une app Electron démarre comme Node | variable `ELECTRON_RUN_AS_NODE=1` héritée. Sans effet sur Tauri, mais `env -u ELECTRON_RUN_AS_NODE` en cas de doute |

## 5. Environnement de test SSH (à partir de T16)

`scripts/test-env/up.sh` démarre avec podman :
- un serveur OpenSSH **cible** (mot de passe + clé) ;
- un **bastion**, qui seul peut joindre la cible.

`scripts/test-env/down.sh` arrête tout. Détails dans la fiche T16.
