# 01 — Architecture technique

> Versions vérifiées sur les registres (npm, crates.io) et compilées ensemble sur le poste de dev le **2026-09-26**.
> Ne pas changer une version majeure, ne pas ajouter de dépendance sans qu'une fiche le demande.

## 1. Vue d'ensemble

```
┌──────────────────────── Fenêtre TunL (WebKitGTK 4.1) ──────────────────────────┐
│ React 19 + TypeScript 6                                                        │
│  features/*  ──►  stores (zustand)  ──►  lib/ipc.ts  ──invoke / Channel──┐     │
│  lib/events.ts ◄── événements globaux (tunl://prompt, …) ◄──────────┐    │     │
└─────────────────────────────────────────────────────────────────────│────│─────┘
                                                                      │    │  IPC Tauri 2
┌──────────────────────── Processus Rust (runtime tokio de Tauri) ────│────▼─────┐
│ commands/*  ─► store/ (JSON atomique)      secrets.rs (oo7 → Secret Service)   │
│             ─► sessions.rs (registre des onglets actifs)                       │
│                 ├─ ssh/   (russh) ─► bastion(s) ─► hôte ─► shell PTY           │
│                 ├─ sftp/  (russh-sftp, même pipeline de connexion)             │
│                 └─ rdp/   ─► processus sdl-freerdp (arguments via stdin)       │
│                           └─ si bastion : tunnel local 127.0.0.1:<port>        │
│             ─► wol.rs (UDP)   probe.rs (TCP)   import/ (ssh2-config)           │
│ prompts.rs : demandes à l'utilisateur (clé d'hôte, mot de passe, 2FA) ─────────┘
└────────────────────────────────────────────────────────────────────────────────┘
```

Règle d'or : **le Rust fait tout ce qui touche au réseau, au disque et aux secrets.**
Le frontend affiche, valide pour le confort, et envoie des intentions.
Le Rust revalide toujours : c'est lui qui fait autorité.

## 2. Stack et versions

### Frontend (`package.json`)

| Rôle | Paquet | Version |
|---|---|---|
| UI | `react`, `react-dom` | ^19.2 (19.3 publiée) |
| Build | `vite` / `@vitejs/plugin-react` | ^8.3 / ^6.1 |
| Langage | `typescript` | ~6.0 (**pas** 7 : l'écosystème n'a pas suivi) |
| CSS | `tailwindcss` + `@tailwindcss/vite` | ^4.3 |
| Composants | `shadcn` CLI 4.21, style `radix-nova`, `radix-ui` ^1.6, `cn` ^0.4 | — |
| Icônes | `lucide-react` | ^1.48 |
| Polices | `@fontsource-variable/geist`, `@fontsource-variable/geist-mono` | ^5.3 |
| Animations | `motion` (import `motion/react`) + `tw-animate-css` | ^13.4 / ^1.4 |
| État | `zustand` | ^5.0 |
| Formulaires | `react-hook-form` + `@hookform/resolvers` + `zod` | ^7.89 / ^5.9 / ^4.6 |
| Terminal | `@xterm/xterm` + addons `fit`, `webgl`, `search`, `web-links`, `unicode11` | ^6.0 |
| Palette | `cmdk` (via le composant shadcn `command`) | ^1.1 |
| Notifications | `sonner` (via le composant shadcn `sonner`) | ^2.0 |
| Listes longues | `@tanstack/react-virtual` | ^3.14 |
| i18n | `i18next` + `react-i18next` | ^26 / ^17 |
| Tauri JS | `@tauri-apps/api` ^2.11, plugins `dialog`, `opener`, `window-state`, `clipboard-manager`, `log` | 2.x |
| Qualité | `@biomejs/biome` (lint + format) | ^2.5 |
| Tests | `vitest` ^5.0, `jsdom` ^30, `@testing-library/react` ^16.3 | — |

### Backend (`src-tauri/Cargo.toml`), Rust édition **2024**, rustc ≥ 1.90

| Rôle | Crate | Version |
|---|---|---|
| App | `tauri` / `tauri-build` | 2.11 / 2.6 |
| Plugins | `tauri-plugin-log`, `-dialog`, `-opener`, `-window-state`, `-single-instance`, `-clipboard-manager` | 2.x |
| Async | `tokio` (rt-multi-thread, macros, net, sync, time, io-util, fs), `tokio-util` | 1.53 / 0.7 |
| SSH | `russh` (features par défaut : aws-lc-rs) | 0.63 |
| SFTP | `russh-sftp` | 3.0 |
| Trousseau | `oo7` (backend auto : Secret Service hors sandbox, portail Secret en Flatpak) | 0.6 |
| Import ssh_config | `ssh2-config` | 0.8 |
| Sérialisation | `serde`, `serde_json` | 1.x |
| Types TS | `ts-rs` (features `serde-compat`, `uuid-impl`) | 12.0 |
| Erreurs | `thiserror` | 2.0 |
| Divers | `uuid` (v4, serde), `zeroize` 1.9, `log` 0.4 | — |

⚠ `russh-keys` n'existe plus comme crate séparée à utiliser : les clés sont dans `russh::keys`.

### Outils système (runtime)

- **FreeRDP 3** : `sdl-freerdp3` / `sdl-freerdp` (préféré), sinon `xfreerdp3` / `xfreerdp`, sinon `wlfreerdp3` / `wlfreerdp`.
  Fedora nomme les binaires sans suffixe `3`, Debian et Ubuntu avec le suffixe.
- Rien d'autre : pas besoin du binaire `ssh`, tout le SSH passe par russh.

## 3. Arborescence cible

```
TunL/
├── AGENTS.md                 règles pour l'agent de code
├── docs/                     ces documents
├── tasks/                    fiches de tâches + plan (README.md)
├── index.html
├── package.json  vite.config.ts  tsconfig*.json  biome.json  components.json
├── src/
│   ├── main.tsx  App.tsx  index.css
│   ├── bindings/             ⚙ GÉNÉRÉ par ts-rs — ne jamais éditer
│   ├── components/ui/        ⚙ GÉNÉRÉ par shadcn — retouches minimales et commentées
│   ├── components/           composants partagés (StatusDot, ProtocolBadge, EmptyState…)
│   ├── features/
│   │   ├── shell/            coquille : TopBar, Sidebar, TabBar, StatusBar, AppLayout
│   │   ├── connections/      store, liste, éditeur, import
│   │   ├── sessions/         store des onglets, overlay de connexion
│   │   ├── terminal/         wrapper xterm, thèmes
│   │   ├── sftp/             explorateur, transferts
│   │   ├── rdp/              carte de session RDP
│   │   ├── palette/          palette de commandes, connexion rapide
│   │   ├── prompts/          dialogues clé d'hôte / mot de passe / 2FA
│   │   ├── home/             tableau de bord d'accueil
│   │   └── settings/         onglet Paramètres
│   ├── i18n/                 index.ts, locales/en.json, locales/fr.json
│   ├── lib/
│   │   ├── ipc.ts            SEUL fichier qui appelle invoke()
│   │   ├── ipc-mock.ts       backend simulé pour `npm run dev:web`
│   │   ├── events.ts         SEUL fichier qui appelle listen()
│   │   ├── errors.ts         normalisation AppError → message i18n
│   │   └── utils.ts          cn()
│   ├── dev/Gallery.tsx       galerie du design system (dev uniquement)
│   └── test/setup.ts
└── src-tauri/
    ├── Cargo.toml  build.rs  tauri.conf.json  .cargo/config.toml
    ├── capabilities/default.json
    └── src/
        ├── main.rs  lib.rs               lib.rs = Builder (plugins, état, commandes)
        ├── error.rs                      AppError
        ├── paths.rs                      dossiers config/données/logs
        ├── state.rs                      AppState
        ├── model/  (mod, connection, group, settings, validate)
        ├── store/  (mod, file, migrate)
        ├── secrets.rs
        ├── prompts.rs                    PromptBroker
        ├── sessions.rs                   SessionRegistry
        ├── ssh/    (mod, handler, known_hosts, auth, connect, chain, shell, forward)
        ├── sftp/   (mod, ops, transfer)
        ├── rdp/    (mod, detect, args, launch)
        ├── wol.rs  probe.rs
        ├── import/ (mod, ssh_config)
        └── commands/ (mod, app, connections, groups, settings, secrets, prompts,
                       ssh, sftp, rdp, wol, probe, import)
```

Taille : ≤ 400 lignes par fichier (800 max absolu). Si un fichier grossit, on le découpe **dans la fiche**,
pas à l'improviste.

## 4. Contrat IPC

### 4.1 Conventions

- Commande Rust `snake_case` (`connection_create`), toujours `async`, retour `Result<T, AppError>`.
- Arguments côté JS en `camelCase` (conversion automatique de Tauri 2) : `invoke("connection_update", { id, input })`.
- Types d'entrée et de sortie : structs Rust `#[derive(Serialize, Deserialize, TS)]` avec `#[serde(rename_all = "camelCase")]`
  et `#[ts(export)]`, générés dans `src/bindings/`.
- `AppError` sérialisé en `{ kind: "<camelCase>", message: string, detail: ErrorDetail | null }`.
  Le frontend traduit `kind` via `errors.<kind>` et affiche `message` en détail repliable.
- Identifiants : `Uuid` v4 (string côté TS).
  **Les `sessionId` sont générés par le frontend** (`crypto.randomUUID()`) pour que l'onglet existe avant la réponse.
- Horodatages : `i64` millisecondes Unix (→ `number` en TS grâce à `TS_RS_LARGE_INT=number`).

### 4.2 Flux de données

| Besoin | Mécanisme |
|---|---|
| Requête / réponse | `invoke` (commande) |
| Sortie terminal (octets) | `Channel<InvokeResponseBody>` Rust → `Channel<ArrayBuffer>` JS, envoi en `InvokeResponseBody::Raw(Vec<u8>)` |
| Événements d'une session (étapes, fin, erreur) | `Channel<SessionEvent>` (JSON), passé à l'ouverture |
| Progression d'un transfert | `Channel<TransferEvent>` (JSON) |
| Demande à l'utilisateur (clé d'hôte, mot de passe, 2FA) | événement global `tunl://prompt` + commande `prompt_answer` |

### 4.3 Catalogue des commandes (cible v1)

| Domaine | Commandes | Fiche |
|---|---|---|
| App | `app_info` | T05 |
| Store | `store_load` → `{ groups, connections, quarantined }`, `connection_templates` (valeurs par défaut) | T08 |
| Connexions | `connection_create`, `connection_update`, `connection_duplicate`, `connection_delete`, `connection_set_favorite`, `connection_touch` (dernière connexion) | T08 |
| Groupes | `group_create`, `group_update`, `group_delete`, `group_reorder` | T08 |
| Réglages | `settings_get`, `settings_update` | T08 |
| Secrets | `secret_set`, `secret_has`, `secret_delete` — **pas de `secret_get`** | T12 |
| Prompts | `prompt_answer` | T17 |
| Clés d'hôte | `known_host_remove` | T17 |
| SSH | `ssh_open`, `ssh_write`, `ssh_resize` | T19 |
| Sessions | `session_close` (tous types) | T19 |
| SFTP | `sftp_open`, `sftp_list`, `sftp_mkdir`, `sftp_rename`, `sftp_remove`, `sftp_chmod`, `sftp_download`, `sftp_upload`, `transfer_cancel` | T24, T26 |
| RDP | `rdp_detect`, `rdp_open` | T27, T28 |
| WoL | `wol_wake` | T29 |
| Disponibilité | `probe_check` | T30 |
| Import / export | `import_ssh_config_preview`, `import_ssh_config_apply`, `store_export`, `store_import` | T15, T32 |

### 4.4 Le mock IPC (`ipc-mock.ts`)

`lib/ipc.ts` regarde `isTauri()` (de `@tauri-apps/api/core`). Hors Tauri, dans un navigateur via `npm run dev:web`,
il route vers `ipc-mock.ts` : données fictives en mémoire, latences simulées, erreurs simulables.

Deux usages :
- l'agent développe et teste l'UI sans compiler le Rust ;
- l'orchestrateur fait des captures d'écran de l'UI dans un navigateur sans tête pour la relire.

**Chaque fiche qui ajoute une commande l'ajoute aussi au mock.**

## 5. Le pipeline de connexion (SSH, SFTP, RDP via bastion)

Une seule fonction construit un lien SSH, quelle que soit l'utilisation finale :

```
ssh::connect::establish(ctx, connection_id, reporter) -> Result<SshLink, AppError>

SshLink { target: Handle<ClientHandler>, hops: Vec<Handle<ClientHandler>> }  // hops gardés vivants
```

Étapes, chacune signalée au frontend via `reporter` (→ `SessionEvent::Step`) :

1. **Wake** (si `wol.wakeBeforeConnect`) : paquet magique, puis attente du port TCP (timeout configurable).
2. **Chain** : résolution de la chaîne `jumpHostId` → liste ordonnée `[bastion1, bastion2, cible]`.
   Refus si cycle, si plus de 4 sauts, ou si un maillon n'est pas SSH.
3. Pour chaque maillon :
   - **Connect** : premier maillon via `TcpStream::connect` (timeout `ssh.connectTimeoutSecs`).
     Maillons suivants via `prev.channel_open_direct_tcpip(host, port, "127.0.0.1", 0)` → `channel.into_stream()`,
     puis `russh::client::connect_stream(config, stream, handler)`.
   - **HostKey** : `ClientHandler::check_server_key` vérifie le fichier `known_hosts` de l'app, puis `~/.ssh/known_hosts`
     en lecture seule. Clé inconnue : demande via `PromptBroker` (bloquant, 5 min max).
     Clé différente : **refus** avec une erreur `ErrorKind::HostKeyChanged` (aucune option « continuer quand même »).
   - **Auth** : selon `settings.auth.method` (voir T18). Le secret vient du trousseau ou d'un prompt.
4. **Open** : selon l'usage, canal shell + PTY (T19), sous-système `sftp` (T24) ou tunnel local (T23).

⚠ Le timeout de connexion s'applique **au TCP seulement**. Il ne doit pas englober `connect_stream` :
l'utilisateur peut mettre une minute à lire l'empreinte d'une clé d'hôte.
Côté russh, on utilise `Config { inactivity_timeout, keepalive_interval, keepalive_max }`.

## 6. Sessions (onglets)

```
SessionKind = ssh | sftp | rdp          (+ onglets "internes" côté UI : settings)
États UI    : connecting ─► connected ─► closed
                   └──────► error ──(reconnect)──► connecting
```

- Rust : `SessionRegistry` = `Mutex<HashMap<Uuid, SessionHandle>>` dans `AppState`.
  `SessionHandle` contient un `CancellationToken` (tokio-util) et, selon le type,
  l'émetteur des entrées du shell, la session SFTP (`Arc`) ou le processus FreeRDP.
- Fermer un onglet → `session_close(id)` → annulation du token.
  Chaque tâche de fond fait `select!` sur le token et libère proprement ses ressources.
- Fin côté serveur (exit du shell, FreeRDP fermé) → `SessionEvent::Closed { reason }` → l'onglet passe en `closed`
  avec un bouton « Reconnecter ».
- Chaque session possède **sa propre connexion SSH**. Pas de mutualisation en v1 : c'est plus simple et plus robuste.

## 7. Prompts (demandes à l'utilisateur)

`PromptBroker` (Rust) : `HashMap<Uuid, oneshot::Sender<PromptAnswer>>`.

```
backend : broker.ask(PromptRequest) ──emit "tunl://prompt"──► UI : <PromptHost/> affiche le bon dialogue
backend ◄──────────── prompt_answer(id, answer) ◄──────────── UI : l'utilisateur répond
```

Types (détaillés dans `05-modele-donnees.md`) : `hostKeyUnknown`, `password`, `passphrase`, `keyboardInteractive`.
Pas de réponse sous 5 minutes, ou `session_close` pendant l'attente → erreur `ErrorKind::Cancelled`.

## 8. RDP

- `rdp/detect.rs` : cherche le client dans l'ordre du §2 (ou le chemin forcé dans les réglages),
  puis vérifie la version 3 via `--version`.
- `rdp/args.rs` : fonction **pure** `build_args(conn, rdp_settings, target: (host, port), creds) -> Vec<String>`,
  testée unitairement.
- `rdp/launch.rs` : lance `<client> /args-from:stdin`, écrit les arguments **un par ligne** sur stdin puis ferme stdin.
  Le mot de passe n'apparaît donc jamais dans `/proc/<pid>/cmdline` (vérifié avec FreeRDP 3.31).
  stdout et stderr sont lus ligne à ligne, filtrés (jamais de secret), et gardés dans un tampon circulaire de 200 lignes
  pour la carte de session.
- Via bastion : `establish()` jusqu'au bastion, puis `ssh::forward` ouvre `127.0.0.1:<port libre>` → direct-tcpip vers
  `host:3389`, et FreeRDP se connecte à `/v:127.0.0.1:<port>`.
  Le tunnel vit tant que le processus FreeRDP vit.

## 9. Persistance

Chemins fournis par `tauri::Manager::path()` (identifiant `io.github.fleorens.TunL`) :

| Fichier | Dossier | Contenu |
|---|---|---|
| `connections.json` | `app_config_dir` | groupes + connexions (**jamais de secret**) |
| `settings.json` | `app_config_dir` | réglages |
| `known_hosts` | `app_data_dir` | clés d'hôte acceptées dans TunL (format OpenSSH) |
| `*.log` | `app_log_dir` | journaux (plugin log, rotation) |

Écriture **atomique** : `x.json.tmp` → `fsync` → `rename` → l'ancienne version devient `x.json.bak`.
JSON illisible au démarrage → renommé `x.json.corrupt-<horodatage>`, on repart d'un store vide,
et l'UI affiche un avertissement persistant. Jamais d'effacement silencieux.

Le store vit en mémoire dans `AppState` (`tokio::sync::RwLock<Store>`).
Chaque mutation valide → construit un **nouveau** `Store` → persiste → remplace. Pas de mutation en place.

## 10. Frontend

- **Pas de routeur.** Une fenêtre, des onglets. L'accueil s'affiche quand aucun onglet n'est actif.
- **Stores zustand** par domaine : `useConnections`, `useSessions`, `useSettings`, `useUi` (sidebar, palette, éditeur ouvert).
  Les actions des stores appellent `ipc`. Les composants lisent les stores avec des sélecteurs.
- **Thème** : classe `dark` sur `<html>` (variant Tailwind `dark`), piloté par `useSettings().theme` + `prefers-color-scheme`.
- **i18n** : `t("clé")` partout, clés `domaine.sousdomaine.nom`, fichiers `en.json` (référence) et `fr.json`.
- **Raccourcis** : un seul module `features/shell/shortcuts.ts` déclare la table. Le terminal laisse passer ces
  combinaisons via `attachCustomKeyEventHandler`.

## 11. Qualité et tests

| Niveau | Outil | Quoi |
|---|---|---|
| Rust unitaire | `cargo test` | modèle, validation, store, migrations, args RDP, WoL, import ssh_config, chaîne de bastions |
| Rust intégration | `cargo test -- --ignored` avec `TUNL_IT=1` | contre les conteneurs OpenSSH de `scripts/test-env/` (T16) |
| TS unitaire | `vitest` | parseur connexion rapide, filtres, stores (ipc mocké), utilitaires |
| Types | `tsc -b` | tout le frontend |
| Style | Biome, `cargo fmt`, `cargo clippy -D warnings` | tout |

`npm run verify` enchaîne tout. **Une fiche n'est livrée que si `npm run verify` passe.**

## 12. Journaux

`tauri-plugin-log` (façade `log`) : niveau `info` en release, `debug` en dev.
Ne jamais journaliser : mot de passe, passphrase, réponse 2FA, contenu du presse-papiers, octets du terminal,
arguments FreeRDP.
Les noms d'hôte et d'utilisateur sont autorisés.
