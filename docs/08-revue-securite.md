# Revue de sécurité — TunL v0.1.0

Revue menée sur le code livré, dans le dépôt. Deux passes :

- **Passe 1 — lecture du code (modèle local)** : ce document. Constats relevés en lisant le code, sans corriger.
- **Passe 2 — revue finale et liste de publication** (`tasks/T40-revue-securite-release.md`) : les constats triés et
  corrigés, la CSP sur le binaire, le Flatpak, la publication `v0.1.0`.

## Passe 1 — lecture du code (modèle local)

### 1. Tableau des constats

Du plus grave au moins grave. Un constat n'est retenu que s'il a un scénario concret (qui fournit la donnée, le chemin
dans le code, ce qui arrive) ; « pourrait être plus robuste » ne compte pas.

| # | Gravité | Règle | Où | Scénario | Correctif proposé |
|---|---|---|---|---|---|
| 1 | mineur | S16 | `src-tauri/.cargo/audit.toml:5` | `cargo audit` (650 deps) ne remonte plus `RUSTSEC-2023-0071` (rsa) : la ligne `ignore` protège un advisory qui n'existe plus. Le commentaire lui-même dit de la supprimer dès que russh dépend d'une version corrigée — ce qui semble fait. Si rsa regresse plus tard, la ligne serait muette et trompeuse. | Supprimer la ligne `RUSTSEC-2023-0071` et son commentaire, après avoir confirmé que russh utilise un rsa patché. |
| 2 | mineur | S16 | `src-tauri/.cargo/audit.toml:1` | `cargo audit` remonte 6 warnings non ignorés : 4 « unmaintained » (`proc-macro-error`, `zbus_names`, `zvariant`, `zvariant_derive`), 1 « unsound » (`glib`, RUSTSEC-2024-0429), 1 « yanked » (`yoke-derive`). Transitives d'`oo7` (backend trousseau). Aucune n'est critique pour TunL (TunL n'utilise pas `VariantStrIter` de glib). | Aucune action ; surveiller le correctif de glib. |
| 3 | mineur | S7 | `src-tauri/src/sftp/ops.rs:71,73` | `map_sftp_error` construit `{op}: permission denied: {path}` / `{op} failed: {path}`. Pour `count` et `remove`, `path`/`current` descend dans des noms de dossier **fournis par le serveur** (ops.rs:152,187). Un serveur malveillant renvoyant un nom de dossier contenant des données sensibles les ferait réapparaître dans un message d'erreur. Ce n'est pas un secret enregistré, donc non bloquant. | Retirer `{path}` du message, ou l'assainir. |

Règles **conformes** (détail par règle ci-dessous) : S1, S2, S3, S4 (code), S5, S6, S8, S9, S10, S11, S12, S13 (code),
S14, S15.

### 2. Les règles S1 à S16

#### S1 — Secrets uniquement dans le trousseau
`grep -rn "create_item\|to_vec_pretty\|connections" src-tauri/src/secrets.rs src-tauri/src/store/exchange.rs`
- `secrets.rs:172` : `create_item(..., value.expose().as_bytes(), true)` — le secret part dans le Secret Service (`oo7`),
  jamais dans un fichier de TunL.
- `store/exchange.rs:63` `export_file` ne clone que `groups` + `connections` : aucun champ secret dans l'export JSON.
- Le frontend garde les secrets dans `secret-drafts.ts`, hors de react-hook-form, jamais en `localStorage` (seulement
  `src/lib/theme.ts`, règle `local-storage`).
Verdict : **conforme**.

#### S2 — Le frontend ne lit jamais un secret
`grep -n "secret_" src-tauri/src/commands/mod.rs` + `npm run rules` (règle `no-secret-read-command`).
- Commandes enregistrées : `secret_set`, `secret_has`, `secret_delete` (`commands/mod.rs:165-167`). Aucune `secret_get`.
- La règle `no-secret-read-command` (qui cherche `secret_get`/`secretGet` dans le TS et le Rust) est verte.
Verdict : **conforme**.

#### S3 — Secrets en mémoire
`grep -rn "Zeroizing\|SecretValue(\*\*\*)" src-tauri/src`
- `secrets.rs:47` `SecretValue(Zeroizing<String>)` (zeroize au drop), `:61` `Debug` manuel qui imprime `SecretValue(***)`.
- `rdp/args.rs:51` `Debug` de `RdpArgs` écrit `/p:***`.
- Tests : `secrets_tests.rs`, `rdp/args_tests.rs:280` `debug_never_shows_the_password`, `prompts_tests.rs:198`
  `assert!(!format!("{secret:?}").contains("hunter2"))`.
Verdict : **conforme**.

#### S4 — Aucun secret dans un argument de processus
`grep -n "\.arg(\|args-from" src-tauri/src/rdp/launch.rs`
- `launch.rs:48` : `command.arg("/args-from:stdin")` seul ; les arguments (mot de passe inclus) sont écrits sur le stdin
  (`launch.rs:60-62`), jamais dans `cmdline`.
Verdict : **conforme dans le code**. À confirmer à la main :
`cat /proc/$(pgrep -f freerdp)/cmdline | tr '\0' ' '` pendant une session RDP → ne montre que `/args-from:stdin`.

#### S5 — Rien d'injectable dans les arguments FreeRDP
`grep -n "no_control\|reserved\|is_control" src-tauri/src/rdp/args.rs src-tauri/src/model/validate_args.rs`
- `args.rs:192` `no_control` refuse `\n`, `\r`, caractères de contrôle sur host/name/serverName/username/domain/password.
- `validate_args.rs:112` `validate_extra_args` refuse les flags réservés (`/p:`, `/u:`, `/v:`, `/args-from`,
  `/server-name`…) et les caractères de contrôle.
Verdict : **conforme**.

#### S6 — Clés d'hôte
`grep -n "HostKeyStatus\|Revoked\|Changed" src-tauri/src/ssh/known_hosts.rs` + `commands/prompts.rs`
- `known_hosts.rs:61` `check` : inconnue → `Unknown` (refus par défaut), différente → `Changed` (refus, sans « continuer »),
  `@revoked` → `Revoked` (refus sans question). `known_hosts.rs:119` `learn` écrit en `0o600`.
- `commands/prompts.rs:24` `known_host_remove` exige un nom d'hôte non vide avant de supprimer.
- `model/connection.rs:141` `RdpCertPolicy { Prompt, Tofu }` : aucune option `Ignore`.
Verdict : **conforme**. À confirmer à la main : rotation de clé (`scripts/test-env/rotate-host-key.sh`) → refus ;
suppression seulement en tapant le nom d'hôte ; RDP via bastion, 2ᵉ session retrouve son certificat.

#### S7 — Erreurs sans fuite
`grep -rn "format!\|AppError::new" src-tauri/src/ssh/error.rs src-tauri/src/sftp/ops.rs`
- `error.rs:56` `AppError.message` est technique, en anglais. `map_russh_error` (`error.rs:38`) reformule sans recopier
  ce que le serveur a envoyé.
- `ops.rs:66` `map_sftp_error` : op + path, jamais le texte du serveur (voir constat 3).
- `secrets.rs:110` `keyring_op`generic ; `rdp/commands.rs:74` log le `error.kind`, pas la valeur.
Verdict : **conforme** (resque mineur : constat 3).

#### S8 — Logs
`grep -rn "log::" src-tauri/src | grep -iE "secret|password|passphrase|cmdline|args"`
- Seuls noms d'hôte, ports, utilisateurs, étapes, codes d'erreur sont logués.
- `rdp/launch.rs:24` `filter_log_line` jette les lignes contenant `password`, `passwd`, `/p:`, `credential`, `secret`.
Verdict : **conforme**. À confirmer à la main : `grep -riE "password|passphrase|BEGIN .*PRIVATE" ~/.local/share/io.github.fleorens.TunL/logs`.

#### S9 — Permissions des fichiers
`grep -rn "0o700\|0o600\|create_new" src-tauri/src/paths.rs src-tauri/src/store/file.rs src-tauri/src/ssh/known_hosts.rs`
- `paths.rs:44` `ensure_private_dir` force `0700` ; `file.rs:49` `write_json_atomic` crée `.tmp` en `0600` par `create_new` ;
  `known_hosts.rs:119` `.bak`/`known_hosts` en `0600` ; `exchange.rs:43` export en `0600`.
Verdict : **conforme**. À confirmer à la main : `stat -c '%a %n' ~/.config/io.github.fleorens.TunL ~/.config/.../*`.

#### S10 — Terminal
`grep -rn "addon\|WebLinksAddon\|isOpenableUrl\|OUTPUT_CHUNK" src`
- `use-xterm.ts:5-8` : aucun `addon-clipboard` (OSC 52) — seulement fit, search, web-links, webgl.
- `use-xterm.ts:79` : un lien ne s'ouvre qu'avec `Ctrl+clic` et en `http`/`https` (`isOpenableUrl`), via `openExternal`.
- `ssh/shell.rs:17` `OUTPUT_CHUNK = 64 KiB` ; `sftp/transfer.rs:21` `CHUNK_SIZE = 64 KiB` : sortie bornée.
Verdict : **conforme**. À regarder à l'écran : un `cat` de 200 Mo ne gelé pas l'UI ; un lien ne s'ouvre qu'au Ctrl+clic.

#### S11 — SFTP
`grep -n "valid_name\|resolves_to_root\|validate_remote_path" src-tauri/src/sftp/ops.rs`
- `ops.rs:17` `validate_remote_path` exige un chemin absolu sans NUL ; `:29` `valid_name` rejette `.`/`..`/`/`/NUL sur chaque
  nom ; `:89,155,187` `list`/`count`/`remove` ignorent les noms qui pourraient s'éviter.
- `:166` `remove` refuse la racine via `resolves_to_root` (`:217`) ; `:125` `chmod` borne le mode à `0o7777`.
Verdict : **conforme**. À confirmer à la main : un serveur avec un nom de fichier `../x` → ignoré.

#### S12 — Import `~/.ssh/config`
`grep -n "Ignored\|ProxyCommand\|LocalCommand\|Match" src-tauri/src/import/ssh_config.rs`
- `ssh_config.rs:261` `make_opt` met `ProxyCommand`, `LocalCommand`, `RemoteCommand`, `KnownHostsCommand`,
  `LocalForward`… en `Opt::Ignored` et les signale en warning (`apply_block`), **sans jamais les exécuter**.
Verdict : **conforme**. À confirmer à la main : `~/.ssh/config` avec `ProxyCommand`/`LocalCommand`/`Match exec`/
`KnownHostsCommand` → rien exécuté (`strace -f -e execve`).

#### S13 — WebView
`grep -rn "csp\|devCsp" src-tauri/tauri.conf.json` + règle `no-html-injection`
- `tauri.conf.json` : CSP stricte en production, `devCsp` désactivée en développement (le serveur Vite injecte des scripts).
- Règle `no-html-injection` (`dangerouslySetInnerHTML`/`eval`/`new Function`) verte.
Verdict : **conforme dans le code**. À confirmer sur le binaire de release (T05/T40) : sous Xvfb avec
`WEBKIT_INSPECTOR_HTTP_SERVER=127.0.0.1:9333`, la balise/meta CSP est présente, `eval("1")` et l'injection d'un
`<script>` en ligne sont refusés, `fetch("https://example.com")` est refusé (`connect-src`).

#### S14 — Capacités Tauri minimales
`cat src-tauri/capabilities/default.json`
- `opener:allow-open-url` (portée `http://` et `https://`), `opener:allow-reveal-item-in-dir`, `clipboard-manager` lecture
  et écriture de texte, `dialog:allow-open`/`save`, contrôles de fenêtre. Rien d'autre.
Verdict : **conforme**.

#### S15 — Réseau à l'initiative de l'utilisateur
`grep -n "PROBE_TIMEOUT\|MAX_PARALLEL_PROBES\|Skipped\|broadcast" src-tauri/src/probe.rs src-tauri/src/wol.rs src-tauri/src/ssh/forward.rs`
- `probe.rs:19` timeout 2 s, `:21` 16 en parallèle, `:84` un hôte derrière un bastion est `Skipped` (aucun accès réseau).
- `wol.rs:153` `wake_target` exclut un hôte avec bastion ; `forward.rs:20` `bind_local` lie en loopback seul.
- Pas de télémétrie, pas de vérification de mise à jour.
Verdict : **conforme**. À confirmer à la main : `ss -tnp` / `tcpdump -i any not port 22` 10 min, sondes coupées → aucune
connexion ; actives → une connexion TCP par adresse.

#### S16 — Dépendances
`npm audit --omit=dev` et `cd src-tauri && cargo audit`
- `npm audit` : **0 vulnérabilités**.
- `cargo audit` : exit 0, 6 warnings (constat 2), `RUSTSEC-2023-0071` absent (constat 1). Lockfiles commités, audit en CI
  (T37).
Verdict : **conforme** (constats 1 et 2).

### 3. Menaces de `docs/06-securite.md` §1

| Actif | Menace | Protection | Test |
|---|---|---|---|
| Secrets (mot de passe, passphrase, 2FA) | fuite sur disque | trousseau `oo7`, jamais `connections.json`/`settings.json` (S1) | `secrets_tests.rs`, `export_file` sans credential |
| | fuite dans les logs | logs de type/étapes seulement (S8) | `filter_log_line` (`rdp/launch.rs:24`) |
| | fuite dans `ps`/`/proc/<pid>/cmdline` | FreeRDP par `/args-from:stdin` (S4) | `rdp/args_tests.rs` |
| | fuite vers le frontend | aucune `secret_get` (S2) | règle `no-secret-read-command` |
| | fuite dans un message d'erreur | `AppError` technique, erreurs reformulées (S7) | `error_tests.rs`, `map_sftp_error` |
| Confiance dans un serveur (clé d'hôte) | homme du milieu | `check` : inconnue→refus, différente→refus, `@revoked`→refus (S6) | `known_hosts_tests.rs`, `ssh_hostkey*.rs` |
| Poste de l'utilisateur | séquences d'échappement, noms piégés, sortie énorme | liens Ctrl+clic http(s), sortie bornée, pas d'addon clipboard (S10) | `terminal-keys.test.ts` |
| | noms de fichiers piégés en SFTP | `valid_name`, `resolves_to_root` (S11) | `sftp/ops_tests.rs` |
| Config importée | `ProxyCommand`/`LocalCommand` | ignorés et signalés, jamais exécutés (S12) | `ssh_config_tests.rs` |
| Fichiers de TunL | lecture par un autre utilisateur local | `0700` dossiers, `0600` fichiers (S9) | `paths tests`, `store ops` |
| Chaîne d'approvisionnement | dépendance compromise | lockfiles commités, `npm`/`cargo audit` en CI (S16) | CI (T37) |

### 4. À faire à la main

Vérifications qui demandent la vraie app, une session réelle ou des droits, et que je n'ai pas pu exécuter :

- **S1** : après une session avec mot de passe mémorisé, `grep -rIl "<le mot de passe>" ~/.config/io.github.fleorens.TunL ~/.local/share/io.github.fleorens.TunL` ne trouve rien ; même chose dans un export JSON.
- **S4** : session RDP réelle, `cat /proc/$(pgrep -f freerdp)/cmdline | tr '\0' ' '` ne montre que `/args-from:stdin`.
- **S6** : clé changée sur le conteneur de test (`scripts/test-env/rotate-host-key.sh`) → refus, suppression seulement en tapant le nom d'hôte ; RDP bastion, 2ᵉ session retrouve son certificat.
- **S8** : après une journée d'usage, `grep -riE "password|passphrase|BEGIN .*PRIVATE" ~/.local/share/io.github.fleorens.TunL/logs`.
- **S9** : `stat -c '%a %n' ~/.config/io.github.fleorens.TunL ~/.config/io.github.fleorens.TunL/*` → `700`/`600`.
- **S10** : un `cat` de 200 Mo ne gelé pas l'UI ; un lien ne s'ouvre qu'au Ctrl+clic en `http(s)`.
- **S11** : un serveur avec un nom de fichier `../x` → ignoré.
- **S12** : `~/.ssh/config` avec `ProxyCommand`/`LocalCommand`/`Match exec`/`KnownHostsCommand` → rien exécuté (`strace -f -e execve`).
- **S13** : binaire de release sous Xvfb (`WEBKIT_INSPECTOR_HTTP_SERVER=127.0.0.1:9333`) : CSP présente, `eval`/`<script>` en ligne/`fetch` refusés.
- **S15** : `ss -tnp` / `tcpdump -i any not port 22` 10 min, sondes coupées → aucune connexion ; actives → une TCP par adresse.
- **S16** : relire `cargo audit` et confirmer que russh dépend d'un rsa patché (supprimer la ligne d'ignore, constat 1).
- **Interface** : un prompt keyboard-interactive (2FA) masque-t-il la réponse quand le serveur pose `echo:false` ? La donnée porte le drapeau (`PromptKind::KeyboardInteractive.prompts[].echo`), le masquage dépend de l'UI — à regarder à l'écran.
- **Flatpak** : un mot de passe mémorisé ne se lit pas hors du bac à sable (`secret-tool search application io.github.fleorens.TunL`) ; `flatpak run --command=sh io.github.fleorens.TunL -c 'ls ~'`.
