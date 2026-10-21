# T38 — Flatpak (manifeste, FreeRDP embarqué, sources hors ligne)

| | |
|---|---|
| **Jalon** | M8 — Distribution |
| **Dépend de** | T37 |
| **Lire avant** | `docs/02-decisions.md` D04 et D14, `docs/06-securite.md` S4 |
| **Livrable** | `packaging/flatpak/` (manifeste fourni, `cargo-sources.json`, `node-sources.json` générés) ; `scripts/flatpak-sources.sh` ; `npm run flatpak:sources` ; une ligne Flatpak dans le `README.md` |

## Pourquoi

Les paquets deb, rpm et AppImage (T37) ne couvrent pas les systèmes immuables (Silverblue, Kinoite, SteamOS…), ni
Flathub. Un Flatpak doit se construire **hors ligne** : chaque crate et chaque paquet npm est déclaré à l'avance dans
deux fichiers de sources, générés depuis les fichiers de verrouillage. FreeRDP 3 est compilé dans le bac à sable (son
client SDL) : TunL n'y lance aucun programme de l'hôte (S4).

Prototypé par l'orchestrateur (branche locale `proto/T38`) : dans un conteneur podman Debian 13, sur le runtime
GNOME 51, les modules `freerdp` et `tunl` se construisent hors ligne. La dernière étape de `flatpak-builder`,
`appstreamcli compose`, échoue **dans podman seulement** : son lecteur d'images (glycin) ne peut pas ouvrir son
propre bac à sable dans un conteneur. Sur une machine normale ou chez Flathub, elle passe. **Le build complet n'est
donc pas à lancer dans cette fiche** (voir « À regarder par Florian »).

## À réutiliser (ne pas réécrire)

- L'entrée de bureau et la metainfo de T36 (`packaging/linux/`) : le manifeste les renomme à l'id de l'app, il ne
  les copie pas.
- Les icônes de T36 (`branding/app-icon.svg`, `src-tauri/icons/`).

## Contrat

### `packaging/flatpak/io.github.fleorens.TunL.yml` (fourni, voir « Tests du contrat »)

- `finish-args` minimaux, chacun commenté : pas de `--filesystem=home`, `~/.ssh` en **lecture seule**.
- La configuration de l'app vit dans `~/.var/app/io.github.fleorens.TunL/` (Flatpak redirige `XDG_CONFIG_HOME`) :
  rien à changer dans le code.
- La source `type: dir` (`../..`) sert au build local. Pour Flathub, elle sera remplacée par une source `git` (tag
  et commit) : hors de cette fiche.

### `scripts/flatpak-sources.sh` (à écrire)

Régénère `packaging/flatpak/cargo-sources.json` et `packaging/flatpak/node-sources.json`, dans un conteneur podman
jetable (aucun paquet à installer sur la machine) :
- image `docker.io/library/debian:13`, avec `git python3 python3-aiohttp python3-toml python3-tomlkit python3-yaml
  pipx` ;
- [flatpak-builder-tools](https://github.com/flatpak/flatpak-builder-tools) cloné au commit
  `74697c75b630d7330e77250fc13cb5ea688d9479` (épinglé, pas `master`) ;
- `python3 cargo/flatpak-cargo-generator.py src-tauri/Cargo.lock -o packaging/flatpak/cargo-sources.json` ;
- `pipx install ./node`, puis `flatpak-node-generator npm package-lock.json -o packaging/flatpak/node-sources.json`.

`package.json` : `"flatpak:sources": "scripts/flatpak-sources.sh"`. Les deux JSON générés sont **commités**.

### `README.md`

Dans la section d'installation, une ligne : construire le Flatpak localement avec
`flatpak-builder --user --install --force-clean build packaging/flatpak/io.github.fleorens.TunL.yml` (runtimes GNOME 51
et extensions `rust-stable`, `node22` de Flathub).

## Pièges (vus au prototype)

- Les deux fichiers de sources se périment **à chaque changement** de `Cargo.lock` ou de `package-lock.json` :
  relancer `npm run flatpak:sources` (le `CONTRIBUTING.md` de T39 le dira dans sa liste « avant une release »).
- `tauri build` vérifie que les versions npm et crate des plugins concordent : l'écart d'`opener` (2.6 / 2.7) est
  corrigé par T30b. S'il réapparaît, le build Flatpak échoue.
- `npm ci --ignore-scripts` : aucun script `postinstall` ne doit être nécessaire au build (Playwright ne télécharge
  rien grâce à `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD`).
- `node-sources.json` fait environ 1 200 entrées et `cargo-sources.json` environ 1 300 : c'est normal, ne pas les
  relire.

## Tests du contrat

### `packaging/flatpak/io.github.fleorens.TunL.yml` (nouveau)

```yaml
# Flatpak of TunL (T38). Built offline: every crate and npm package comes from cargo-sources.json and
# node-sources.json (regenerate them with scripts/flatpak-sources.sh after a lockfile changes).
# FreeRDP 3 (its SDL client) is built in the sandbox: TunL never runs a program of the host (S4, D04).
app-id: io.github.fleorens.TunL
runtime: org.gnome.Platform
runtime-version: "51"
sdk: org.gnome.Sdk
sdk-extensions:
  - org.freedesktop.Sdk.Extension.rust-stable
  - org.freedesktop.Sdk.Extension.node22
command: tunl
finish-args:
  # The window: Wayland first, X11 when there is no Wayland; the GPU for WebKit.
  - --socket=wayland
  - --socket=fallback-x11
  - --share=ipc
  - --device=dri
  # SSH, SFTP, RDP, Wake-on-LAN and the reachability probes.
  - --share=network
  # The user's SSH agent (agent authentication, T18).
  - --socket=ssh-auth
  # Read only: ~/.ssh/known_hosts (D10), ~/.ssh/config (import, T15), private keys chosen in the editor.
  - --filesystem=~/.ssh:ro
  # Where downloads go by default (Settings › SFTP can choose another folder through the portal).
  - --filesystem=xdg-download
  # RDP sound, played by FreeRDP.
  - --socket=pulseaudio
modules:
  - name: freerdp
    buildsystem: cmake-ninja
    builddir: true
    config-opts:
      - -DCMAKE_BUILD_TYPE=Release
      - -DWITH_CLIENT_SDL=ON
      - -DWITH_CLIENT_SDL2=OFF
      - -DWITH_CLIENT_SDL3=ON
      - -DWITH_X11=OFF
      - -DWITH_WAYLAND=OFF
      - -DWITH_SERVER=OFF
      - -DWITH_SAMPLE=OFF
      - -DWITH_PROXY=OFF
      - -DWITH_SHADOW=OFF
      - -DWITH_PLATFORM_SERVER=OFF
      - -DWITH_MANPAGES=OFF
      - -DWITH_CUPS=OFF
      - -DWITH_PCSC=OFF
      - -DWITH_FUSE=OFF
      - -DWITH_FFMPEG=OFF
      - -DWITH_SWSCALE=OFF
      - -DWITH_DSP_FFMPEG=OFF
      - -DWITH_ALSA=OFF
      - -DWITH_OSS=OFF
      - -DWITH_PULSE=ON
      - -DWITH_AAD=OFF
      - -DWITH_WEBVIEW=OFF
      - -DWITH_SDL_IMAGE_DIALOGS=OFF
      - -DCHANNEL_URBDRC=OFF
      - -DWITH_KRB5=OFF
    cleanup:
      - /include
      - /lib/cmake
      - /lib/pkgconfig
      - /bin/winpr-*
    sources:
      - type: archive
        url: https://github.com/FreeRDP/FreeRDP/releases/download/3.32.1/freerdp-3.32.1.tar.gz
        sha256: 3021cf8848efbd0064664e187cb61e6101e4e74a4d8ffb495d9f7715e22d67de

  - name: tunl
    buildsystem: simple
    build-options:
      append-path: /usr/lib/sdk/rust-stable/bin:/usr/lib/sdk/node22/bin
      env:
        CARGO_HOME: /run/build/tunl/cargo
        CARGO_NET_OFFLINE: "true"
        npm_config_offline: "true"
        npm_config_cache: /run/build/tunl/flatpak-node/npm-cache
        PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1"
    build-commands:
      - npm ci --offline --ignore-scripts
      # The interface (tsc + Vite), then the Rust binary with the interface embedded (no packages: Flatpak is one).
      - npx tauri build --no-bundle -- --offline
      - install -Dm755 src-tauri/target/release/tunl /app/bin/tunl
      # The desktop entry and the metainfo of T36, under the app id, as Flathub wants them.
      - >-
        sed -e 's/{{exec}}/tunl/' -e 's/{{icon}}/io.github.fleorens.TunL/'
        -e 's/{{comment}}/SSH, SFTP and RDP connections, with jump hosts and Wake-on-LAN/'
        packaging/linux/tunl.desktop.hbs > io.github.fleorens.TunL.desktop
      - install -Dm644 io.github.fleorens.TunL.desktop /app/share/applications/io.github.fleorens.TunL.desktop
      - >-
        sed 's#<launchable type="desktop-id">tunl.desktop</launchable>#<launchable type="desktop-id">io.github.fleorens.TunL.desktop</launchable>#'
        packaging/linux/io.github.fleorens.TunL.metainfo.xml > io.github.fleorens.TunL.metainfo.xml
      - install -Dm644 io.github.fleorens.TunL.metainfo.xml /app/share/metainfo/io.github.fleorens.TunL.metainfo.xml
      - install -Dm644 branding/app-icon.svg /app/share/icons/hicolor/scalable/apps/io.github.fleorens.TunL.svg
      - install -Dm644 src-tauri/icons/128x128.png /app/share/icons/hicolor/128x128/apps/io.github.fleorens.TunL.png
      - install -Dm644 src-tauri/icons/128x128@2x.png /app/share/icons/hicolor/256x256/apps/io.github.fleorens.TunL.png
    sources:
      - type: dir
        path: ../..
        skip:
          - node_modules
          - dist
          - src-tauri/target
          - test-results
          - .flatpak-builder
          - flatpak-build
      - cargo-sources.json
      - node-sources.json
```

## Étapes

1. Le manifeste : `node scripts/contract-tests.mjs T38`.
2. `scripts/flatpak-sources.sh` (exécutable), le script npm, puis `npm run flatpak:sources` : les deux JSON
   apparaissent dans `packaging/flatpak/`.
3. La ligne du `README.md`.
4. `npm run format`, `npm run verify`, cases, statut, commit
   `chore: Flatpak manifest with FreeRDP and offline sources (T38)`.

## Critères d'acceptation

- [x] `node scripts/contract-tests.mjs T38 --check` affiche `OK`, et `npm run verify` passe.
- [x] `npm run flatpak:sources` régénère les deux fichiers ; relancé une fois de plus, `git status` reste propre.
- [x] Aucune nouvelle exception `project-rules: allow`.

## À regarder par Florian

Sur ton poste (pas la devbox : l'étape `appstreamcli compose` échoue dans podman) :
`flatpak install flathub org.gnome.Sdk//51 org.freedesktop.Sdk.Extension.rust-stable//26.08
org.freedesktop.Sdk.Extension.node22//26.08`, puis la commande `flatpak-builder` du `README.md`, puis
`flatpak run io.github.fleorens.TunL`. Compter 20 à 40 minutes au premier build (FreeRDP et Rust en release).
À vérifier : l'icône dans le menu, une session SSH (agent compris), une session RDP (le client SDL de FreeRDP).
