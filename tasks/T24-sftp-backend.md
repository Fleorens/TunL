# T24 — Backend SFTP : session, liste, dossier, renommer, supprimer, droits (+ ipc et mock)

| | |
|---|---|
| **Jalon** | M4 — SFTP |
| **Dépend de** | T23 |
| **Lire avant** | `docs/01-architecture.md` §4.3 (ligne SFTP) et §6, `docs/06-securite.md` S7, S8 et **S11**, `docs/05-modele-donnees.md` §8 (`RemoteEntry`, `EntryKind`) |
| **Livrable** | module `src-tauri/src/sftp/` (`mod.rs`, `ops.rs`, `session.rs`), `commands/sftp.rs` (8 commandes), `AppState.sftp` ; `ipc.sftp*` ; mock SFTP avec un système de fichiers en mémoire ; 4 fichiers de tests |

## Pourquoi

L'explorateur SFTP (T25, T25b) et les transferts (T26) parlent au serveur par ces commandes. Une session SFTP est
un onglet comme un shell : mêmes étapes (bastions, clé d'hôte, authentification, via `establish` de T23), puis une
étape `Open` « sftp » qui ouvre le sous-système `sftp` sur un canal. Tant que l'onglet est connecté, sa
`SftpSession` vit dans un registre, et chaque commande `sftp_*` la retrouve par l'id de l'onglet.

Le mock simule le même comportement sur un petit arbre de fichiers en mémoire : T25 et T25b se construisent
dessus, sans serveur.

Prototypé par l'orchestrateur contre les conteneurs de T16 : les tests de cette fiche passent.

## À réutiliser (ne pas réécrire)

- T23 : `ssh::link::{establish, SshLink}` ; T19 / T29 : `ssh::session::{resolve_target, default_username,
  connect_step, SessionTarget}`, `wol::{wake_target, run_wake_step, WAKE_POLL_INTERVAL}` (un onglet SFTP réveille
  l'hôte comme un shell).
- `ssh::error::map_russh_error` ; `sessions::{SessionRegistry, SessionHandle, SessionSink, SessionEvent}`.
- `commands/ssh.rs` : `ssh_open` est le modèle de `sftp_open` (lis-le d'abord).
- Mock : `resolveTarget`, `scheduler`, `promptStep` et la carte `sessions` de `lib/mock/sessions.ts`.

## Contrat — Rust

### `src-tauri/Cargo.toml`

`russh-sftp = "3.0"` (prévu par `docs/01-architecture.md` §2), juste sous `russh`. Aucune autre dépendance.

### `src-tauri/src/sftp/mod.rs` (`lib.rs` : `pub mod sftp;`)

`pub mod ops; pub mod session;` et `#[cfg(test)] mod ops_tests;`, puis :

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)] #[serde(rename_all = "camelCase")] #[ts(export)]
pub enum EntryKind { File, Dir, Symlink, Other }

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)] #[serde(rename_all = "camelCase")] #[ts(export)]
pub struct RemoteEntry {
    pub name: String,
    pub path: String,               // dir + "/" + name
    pub kind: EntryKind,
    pub size: u64,
    pub modified_at: Option<i64>,   // millisecondes Unix
    pub permissions: Option<u32>,   // bits 0o7777 seulement, sans le type
    pub hidden: bool,               // le nom commence par "."
}

/// Les onglets SFTP connectés, par id d'onglet.
#[derive(Default)]
pub struct SftpRegistry { /* Mutex<HashMap<Uuid, Arc<SftpSession>>> */ }
impl SftpRegistry {
    pub fn insert(&self, id: Uuid, session: Arc<SftpSession>);
    /// `NotFound("sftp session <id>")` quand l'onglet n'est pas (ou plus) connecté.
    pub fn get(&self, id: Uuid) -> AppResult<Arc<SftpSession>>;
    pub fn remove(&self, id: Uuid);
}
```

`state.rs` : `AppState` gagne `pub sftp: Arc<SftpRegistry>` (`Arc::new(SftpRegistry::default())` aux deux endroits
où `sessions` est construit).

### `src-tauri/src/sftp/ops.rs`

Fonctions **pures** (testées sans serveur) :

| Fonction | Règle |
|---|---|
| `validate_remote_path(field, path) -> AppResult<()>` | commence par `/`, aucun `\0` ; sinon `validation(field, …)` |
| `valid_name(name) -> bool` | ni vide, ni `.`, ni `..`, ni `/`, ni `\0` (S11) |
| `join(dir, name) -> String` | sans doubler le `/` de la racine |
| `entry_from(dir, name, attrs: &Metadata) -> RemoteEntry` | le type d'après `attrs.file_type()` (un lien reste `Symlink`), `size` (0 si absent), `mtime` × 1000, `permissions & 0o7777` |
| `map_sftp_error(op, path, &SftpError) -> AppError` | `NoSuchFile` → `not_found(path)` ; `PermissionDenied` → `Sftp`, `"<op>: permission denied: <path>"` ; autre statut → `Sftp`, `"<op> failed: <path>"` ; `Timeout` → `Timeout` ; `IO` → `Network`, `"connection closed"`. **Jamais** le texte du serveur (S7) |

Opérations sur une `&SftpSession` (`russh_sftp::client::SftpSession`) :

| Fonction | Comportement |
|---|---|
| `realpath(sftp, path) -> String` | `canonicalize` (`.` → le dossier personnel) |
| `list(sftp, dir) -> Vec<RemoteEntry>` | `read_dir` ; un nom invalide est **sauté** avec un `log::warn!` (qui nomme le dossier, pas le nom) ; trié par nom |
| `mkdir(sftp, path)` | `create_dir` |
| `rename(sftp, from, to)` | `rename` ; champs d'erreur `from` / `to` |
| `chmod(sftp, path, mode)` | `mode > 0o7777` → `validation("mode", …)` ; sinon `set_metadata` avec seulement `permissions` |
| `count(sftp, path) -> u64` | le nombre d'entrées qu'une suppression effacerait, `path` compris ; un lien compte pour un, on n'y **entre** pas |
| `remove(sftp, path)` | `/` → `validation("path", "cannot remove the root")` ; un fichier ou un lien : `remove_file` ; un dossier : tout son contenu d'abord (en profondeur), puis `remove_dir`. On teste le type avec `symlink_metadata` (lstat) : un lien vers un dossier est supprimé **comme lien**, sa cible n'est jamais touchée |

`count` et `remove` parcourent l'arbre avec une **pile** (pas de récursion `async`).

### `src-tauri/src/sftp/session.rs`

```rust
pub const LIVENESS_INTERVAL: Duration = Duration::from_secs(2);
#[derive(Debug)]
pub struct SftpRun { pub id: Uuid, pub target: SshTarget, pub cancel: CancellationToken }

/// Le sous-système "sftp" sur un nouveau canal de `handle`.
pub async fn open_sftp(handle: &Handle<ClientHandler>) -> AppResult<SftpSession>;
pub async fn run_sftp_session(ctx: SshContext, run: SftpRun, sink: Arc<dyn SessionSink>, registry: Arc<SftpRegistry>);
```

- `open_sftp` : `channel_open_session()`, `request_subsystem(true, "sftp")`, `SftpSession::new(channel.into_stream())`.
  Refus du sous-système → `ErrorKind::Sftp`, `"the server has no SFTP subsystem"` (l'erreur détaillée dans un
  `log::warn!`).
- `run_sftp_session` : `establish` (arrêt sur `None`) ; `connect_step(…, StepKind::Open, "sftp", || open_sftp(…))` ;
  `registry.insert(id, Arc::new(sftp))` ; `Connected` ; puis attendre **le premier** de : `cancel` →
  `CloseReason::UserClosed`, ou la connexion SSH perdue (`link.target.is_closed()`, testé toutes les
  `LIVENESS_INTERVAL`) → `RemoteClosed`. Ensuite `registry.remove(id)`, `Closed { reason, exit_status: None }`,
  `link.disconnect()`.

### `src-tauri/src/commands/sftp.rs` (nouveau)

| Commande | Arguments | Retour |
|---|---|---|
| `sftp_open` | `session_id: Uuid, target: SessionTarget, on_event: Channel<SessionEvent>` | `()` |
| `sftp_realpath` | `session_id, path: String` | `String` |
| `sftp_list` | `session_id, path` | `Vec<RemoteEntry>` |
| `sftp_mkdir` | `session_id, path` | `()` |
| `sftp_rename` | `session_id, from: String, to: String` | `()` |
| `sftp_count` | `session_id, path` | `u64` |
| `sftp_remove` | `session_id, path` | `()` |
| `sftp_chmod` | `session_id, path, mode: u32` | `()` |

- `sftp_open` suit `ssh_open` : `resolve_target` (ses refus reviennent tout de suite, rien n'est lancé),
  `wake_target`, inscription dans `state.sessions` (le jeton d'annulation ; un onglet SFTP ne reçoit pas de
  frappes : on crée un canal `mpsc` dont on ne lit jamais le récepteur), puis `spawn` : réveil éventuel,
  `run_sftp_session`, et à la fin `state.sftp.remove`, `sessions.remove`, `prompts.cancel_session`.
- `session_close` (T19) ferme aussi un onglet SFTP : rien à ajouter.
- Le `sink` d'un onglet SFTP n'envoie que des événements : une petite struct `EventSink { on_event }` dont `output`
  ne fait rien.
- Les autres : `ops::<op>(&*state.sftp.get(session_id)?, …)`.
- `commands/mod.rs` : `pub mod sftp;` et `#[cfg(test)] mod ipc_sftp_tests;`. `lib.rs` : les 8 commandes dans
  `invoke_handler()`.

## Contrat — Frontend

- `npm run bindings` : `RemoteEntry.ts`, `EntryKind.ts`.
- `src/lib/ipc.ts`, section `// SFTP (T24): …` :
  - `sftpOpen(sessionId, target, onEvent)` → `call<void>("sftp_open", { sessionId, target, onEvent })`, avec
    `onEvent` passé tel quel au mock et dans un `new Channel<SessionEvent>(onEvent)` dans Tauri (même règle que
    `sessionChannels`) ;
  - `sftpRealpath(sessionId, path)`, `sftpList`, `sftpMkdir`, `sftpRename(sessionId, from, to)`, `sftpCount`,
    `sftpRemove`, `sftpChmod(sessionId, path, mode)`, avec exactement les clés du tableau ci-dessus.
- `src/lib/mock/sessions.ts` : extraire de `runSession` une fonction **exportée**
  `connectSteps(session, target): Promise<boolean>` (réveil, bastions, cible, clé d'hôte, authentification ;
  `false` quand la tentative s'arrête) ; `runSession` l'appelle puis ouvre le shell. Exporter aussi `LiveSession`,
  `ResolvedTarget`, `resolveTarget`, `scheduler` et la carte `sessions` (commentée : « every live mock session,
  shell or SFTP »).
- `src/lib/mock/sftp-fs.ts` (nouveau) : un système de fichiers **immuable** (`ReadonlyMap<chemin, MockNode>`),
  fonctions pures qui renvoient une nouvelle carte ou lèvent l'`AppError` du backend : `demoFs()`,
  `withHome(fs, user)`, `realpath(fs, path, home)`, `list`, `mkdir`, `rename`, `count`, `remove`, `chmod`.
  Contenu attendu par les tests : `/etc/hostname`, `/var/www/html/{index.html, assets/app.js}`, `/var/log/syslog`,
  et pour chaque utilisateur `/home/<user>/{.bashrc, notes.txt, backup.tar.gz (734 003 200 octets), projects/,
  projects/README.md, projects/app/, projects/app/main.rs, current (lien)}`.
- `src/lib/mock/sftp.ts` (nouveau) : `sftpHandlers` (les 8 commandes) et `resetMockSftp()`. `sftp_open` crée une
  `LiveSession` (champs de shell inutilisés), l'inscrit dans `sessions`, puis en tâche de fond : `connectSteps`,
  étape `open` « sftp », `withHome`, `connected`. Les autres commandes : onglet non connecté → `notFound`.
- `src/lib/ipc-mock.ts` : `...sftpHandlers`, et `resetMockSftp()` dans `resetMockBackend()`.

## Pièges (vus au prototype)

- `SftpSession` n'implémente pas `Debug` : `assert_eq!(registry.get(id).unwrap_err()…)` ne compile pas ; on passe
  par `.err().expect(…)`. Pour la même raison, `SftpRegistry` n'a pas de `#[derive(Debug)]`.
- OpenSSH donne pour `readdir` les attributs de l'entrée **elle-même** (un lien reste un lien) : c'est ce qu'on veut.
  Pour `count` et `remove`, on demande `symlink_metadata` (lstat), jamais `metadata` (stat suit les liens).
- `russh_sftp::client::fs::Metadata` est un alias de `russh_sftp::protocol::FileAttributes` :
  `Metadata { permissions: Some(mode), ..Metadata::empty() }` pour un chmod.
- Le contrat IPC (`src/lib/ipc-contract.test.ts`) exige que **chaque** commande d'`ipc.ts` apparaisse dans un
  `ipc*_tests.rs` : `sftp_open` y est appelé avec `"onEvent": "__CHANNEL__:1"`, comme `ssh_open`.
- Le mock garde un seul système de fichiers pour tous les onglets : un dossier créé dans un onglet se voit dans
  l'autre, comme sur un vrai serveur.
- Deux pièges d'OpenSSH, déjà contournés dans `ssh_sftp.rs` (vu au prototype) : `SftpSession::write` n'ouvre qu'un
  fichier **existant** (créer : `create`, puis `write_all` et `shutdown`) ; et le serveur lit les deux chemins de
  `SSH_FXP_SYMLINK` dans l'ordre inverse du brouillon du protocole (`symlink(cible, lien)`).
- **`npm run test:ssh` recrée les conteneurs** avec les clés de ton clone : ne le lance jamais pendant qu'un autre
  clone l'utilise.

## Tests du contrat

### `src-tauri/src/sftp/ops_tests.rs` (nouveau)

```rust
use russh_sftp::client::error::Error as SftpError;
use russh_sftp::client::fs::Metadata;
use russh_sftp::protocol::{FileAttributes, Status, StatusCode};

use super::EntryKind;
use super::ops::{entry_from, join, map_sftp_error, valid_name, validate_remote_path};
use crate::error::ErrorKind;

fn attrs(mode: u32, size: u64, mtime: u32) -> Metadata {
    FileAttributes {
        size: Some(size),
        permissions: Some(mode),
        mtime: Some(mtime),
        ..FileAttributes::empty()
    }
}

fn status(code: StatusCode, server_text: &str) -> SftpError {
    SftpError::Status(Status {
        id: 1,
        status_code: code,
        error_message: server_text.into(),
        language_tag: "en".into(),
    })
}

#[test]
fn names_that_could_escape_a_directory_are_invalid() {
    for bad in ["", ".", "..", "a/b", "/etc", "x\0y"] {
        assert!(!valid_name(bad), "{bad:?}");
    }
    for good in ["index.html", ".bashrc", "...", "a b", "été", "-rf"] {
        assert!(valid_name(good), "{good:?}");
    }
}

#[test]
fn remote_paths_are_absolute_and_without_nul() {
    assert!(validate_remote_path("path", "/var/www").is_ok());
    assert!(validate_remote_path("path", "/").is_ok());
    for bad in ["", "var/www", "~/x", "/var\0/www"] {
        let error = validate_remote_path("path", bad).unwrap_err();
        assert_eq!(error.kind, ErrorKind::Validation, "{bad:?}");
        assert!(error.message.starts_with("path"), "{}", error.message);
    }
}

#[test]
fn join_does_not_double_the_root_slash() {
    assert_eq!(join("/", "etc"), "/etc");
    assert_eq!(join("/var/www", "html"), "/var/www/html");
    assert_eq!(join("/var/www/", "html"), "/var/www/html");
}

#[test]
fn an_entry_keeps_its_kind_mode_size_and_date() {
    let file = entry_from("/srv", "notes.txt", &attrs(0o100644, 4200, 1_700_000_000));
    assert_eq!(file.name, "notes.txt");
    assert_eq!(file.path, "/srv/notes.txt");
    assert_eq!(file.kind, EntryKind::File);
    assert_eq!(file.size, 4200);
    assert_eq!(file.permissions, Some(0o644), "type bits are dropped");
    assert_eq!(file.modified_at, Some(1_700_000_000_000));
    assert!(!file.hidden);

    let dir = entry_from("/", ".config", &attrs(0o040700, 4096, 0));
    assert_eq!(dir.kind, EntryKind::Dir);
    assert_eq!(dir.path, "/.config");
    assert!(dir.hidden);

    let link = entry_from("/srv", "current", &attrs(0o120777, 9, 0));
    assert_eq!(
        link.kind,
        EntryKind::Symlink,
        "a link is shown as one, never followed"
    );

    let fifo = entry_from("/srv", "pipe", &attrs(0o010600, 0, 0));
    assert_eq!(fifo.kind, EntryKind::Other);

    let bare = entry_from("/srv", "x", &FileAttributes::empty());
    assert_eq!(bare.size, 0);
    assert_eq!(bare.modified_at, None);
    assert_eq!(bare.permissions, None);
}

#[test]
fn sftp_errors_are_reworded_without_the_server_text() {
    let missing = map_sftp_error(
        "list",
        "/nope",
        &status(StatusCode::NoSuchFile, "SECRET-TEXT"),
    );
    assert_eq!(missing.kind, ErrorKind::NotFound);

    let denied = map_sftp_error(
        "remove",
        "/root",
        &status(StatusCode::PermissionDenied, "SECRET-TEXT"),
    );
    assert_eq!(denied.kind, ErrorKind::Sftp);
    assert!(
        denied.message.contains("permission denied"),
        "{}",
        denied.message
    );
    assert!(denied.message.contains("/root"));

    let failed = map_sftp_error(
        "mkdir",
        "/srv/x",
        &status(StatusCode::Failure, "SECRET-TEXT"),
    );
    assert_eq!(failed.kind, ErrorKind::Sftp);

    let timeout = map_sftp_error("list", "/srv", &SftpError::Timeout);
    assert_eq!(timeout.kind, ErrorKind::Timeout);

    let closed = map_sftp_error(
        "list",
        "/srv",
        &SftpError::IO("broken pipe SECRET-TEXT".into()),
    );
    assert_eq!(closed.kind, ErrorKind::Network);

    for error in [missing, denied, failed, timeout, closed] {
        assert!(
            !error.message.contains("SECRET-TEXT"),
            "S7: {}",
            error.message
        );
    }
}
```

### `src-tauri/src/commands/ipc_sftp_tests.rs` (nouveau)

```rust
use serde_json::json;

use super::ipc_tests::{create_connection, invoke, mock_app, ok};

#[test]
fn sftp_commands_accept_the_arguments_sent_by_ipc_ts() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());
    let id = "5b6f2d3e-0000-4000-8000-000000000042";

    // No SFTP tab is connected: every command read its arguments, then found no session.
    let calls = [
        ("sftp_realpath", json!({ "sessionId": id, "path": "." })),
        ("sftp_list", json!({ "sessionId": id, "path": "/srv" })),
        ("sftp_mkdir", json!({ "sessionId": id, "path": "/srv/new" })),
        (
            "sftp_rename",
            json!({ "sessionId": id, "from": "/srv/a", "to": "/srv/b" }),
        ),
        ("sftp_count", json!({ "sessionId": id, "path": "/srv/a" })),
        ("sftp_remove", json!({ "sessionId": id, "path": "/srv/a" })),
        (
            "sftp_chmod",
            json!({ "sessionId": id, "path": "/srv/a", "mode": 420 }),
        ),
    ];
    for (cmd, args) in calls {
        let error = invoke(&webview, cmd, args).unwrap_err();
        assert_eq!(error["kind"], "notFound", "{cmd}: {error}");
    }
}

#[test]
fn sftp_open_accepts_the_arguments_sent_by_ipc_ts() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());
    let web = create_connection(&webview, "web");
    let session = "5b6f2d3e-0000-4000-8000-000000000043";

    // The tab runs in the background: `sftp_open` answers at once, its steps go to the channel.
    let opened = ok(
        &webview,
        "sftp_open",
        json!({
            "sessionId": session,
            "target": { "type": "saved", "connectionId": web["id"] },
            "onEvent": "__CHANNEL__:1"
        }),
    );
    assert_eq!(opened, json!(null));
    ok(&webview, "session_close", json!({ "sessionId": session }));

    // A target refused before anything starts.
    let error = invoke(
        &webview,
        "sftp_open",
        json!({
            "sessionId": "5b6f2d3e-0000-4000-8000-000000000044",
            "target": { "type": "quick", "host": "bad host!", "port": 22, "username": null },
            "onEvent": "__CHANNEL__:1"
        }),
    )
    .unwrap_err();
    assert_eq!(error["kind"], "validation");
}
```

### `src-tauri/tests/ssh_sftp.rs` (nouveau, contre podman : `npm run test:ssh`)

```rust
//! T24 against the podman target of T16: an SFTP session and the explorer's operations. `npm run test:ssh`.
//! Every test works in its own directory under `/tmp` of the target container.
#![cfg(feature = "test-env")]

mod support;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh_sftp::client::SftpSession;
use support::{TestEnv, context, respond};
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;
use tunl_lib::error::ErrorKind;
use tunl_lib::prompts::PromptBroker;
use tunl_lib::secrets::{SecretKind, SecretStore, SecretValue};
use tunl_lib::sessions::{CloseReason, SessionEvent, SessionSink, StepKind, StepState};
use tunl_lib::sftp::session::{SftpRun, open_sftp, run_sftp_session};
use tunl_lib::sftp::{EntryKind, SftpRegistry, ops};
use tunl_lib::ssh::SshContext;
use tunl_lib::ssh::auth::AuthPlan;
use tunl_lib::ssh::link::{SshLink, establish};
use tunl_lib::ssh::session::SshTarget;
use uuid::Uuid;

#[derive(Default)]
struct Recorder(Mutex<Vec<SessionEvent>>);

impl SessionSink for Recorder {
    fn event(&self, event: SessionEvent) {
        self.0.lock().unwrap().push(event);
    }
    fn output(&self, _bytes: Vec<u8>) {}
}

impl Recorder {
    fn events(&self) -> Vec<SessionEvent> {
        self.0.lock().unwrap().clone()
    }
}

fn target(env: &TestEnv) -> SshTarget {
    SshTarget {
        connection_id: Some(Uuid::new_v4()),
        connection_name: "target".into(),
        host: env.host("target"),
        port: env.port("target"),
        username: env.user(),
        plan: AuthPlan::Password,
        connect_timeout: Duration::from_secs(5),
        keepalive_secs: 15,
        jump_hosts: Vec::new(),
    }
}

async fn ctx_for(env: &TestEnv, dir: &std::path::Path, target: &SshTarget) -> SshContext {
    let secrets = SecretStore::memory();
    secrets
        .set(
            target.connection_id.unwrap(),
            "target",
            SecretKind::Password,
            &SecretValue::new(env.password()),
        )
        .await
        .unwrap();
    let broker = Arc::new(PromptBroker::new());
    respond(&broker, vec![]);
    context(env, dir, broker, secrets)
}

/// Create (or replace) a remote file with `bytes`. `SftpSession::write` only opens an existing file.
async fn put(sftp: &SftpSession, path: &str, bytes: &[u8]) {
    let mut file = sftp.create(path).await.unwrap();
    file.write_all(bytes).await.unwrap();
    file.shutdown().await.unwrap();
}

/// A symbolic link at `link` pointing to `target`. OpenSSH reads the two paths of SSH_FXP_SYMLINK in the reverse
/// order of the protocol draft: russh-sftp's `symlink(path, target)` gets the target first.
async fn link_to(sftp: &SftpSession, target: &str, link: &str) {
    sftp.symlink(target, link).await.unwrap();
}

/// A link to the target, an SFTP session on it, and a fresh directory to play in.
async fn sftp(env: &TestEnv, dir: &std::path::Path) -> (SshLink, SftpSession, String) {
    let target = target(env);
    let ctx = ctx_for(env, dir, &target).await;
    let link = establish(
        &ctx,
        &target,
        Uuid::new_v4(),
        CancellationToken::new(),
        &Recorder::default(),
    )
    .await
    .expect("a link to the target");
    let sftp = open_sftp(&link.target).await.unwrap();
    let base = format!("/tmp/tunl-sftp-{}", Uuid::new_v4());
    ops::mkdir(&sftp, &base).await.unwrap();
    (link, sftp, base)
}

#[tokio::test]
async fn the_home_directory_and_a_listing_with_every_kind() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let (link, sftp, base) = sftp(&env, dir.path()).await;

    let home = ops::realpath(&sftp, ".").await.unwrap();
    assert_eq!(home, format!("/home/{}", env.user()));

    put(&sftp, &format!("{base}/b.txt"), b"hello").await;
    put(&sftp, &format!("{base}/.hidden"), b"").await;
    ops::mkdir(&sftp, &format!("{base}/a-dir")).await.unwrap();
    link_to(&sftp, &format!("{base}/b.txt"), &format!("{base}/link")).await;

    let entries = ops::list(&sftp, &base).await.unwrap();
    let summary: Vec<(&str, EntryKind, bool)> = entries
        .iter()
        .map(|e| (e.name.as_str(), e.kind, e.hidden))
        .collect();
    assert_eq!(
        summary,
        [
            (".hidden", EntryKind::File, true),
            ("a-dir", EntryKind::Dir, false),
            ("b.txt", EntryKind::File, false),
            ("link", EntryKind::Symlink, false),
        ]
    );
    let file = &entries[2];
    assert_eq!(file.path, format!("{base}/b.txt"));
    assert_eq!(file.size, 5);
    assert!(file.modified_at.is_some());
    assert!(file.permissions.is_some_and(|mode| mode <= 0o7777));

    ops::remove(&sftp, &base).await.unwrap();
    link.disconnect().await;
}

#[tokio::test]
async fn mkdir_rename_and_chmod() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let (link, sftp, base) = sftp(&env, dir.path()).await;

    ops::mkdir(&sftp, &format!("{base}/new")).await.unwrap();
    let again = ops::mkdir(&sftp, &format!("{base}/new")).await.unwrap_err();
    assert_eq!(again.kind, ErrorKind::Sftp);

    ops::rename(&sftp, &format!("{base}/new"), &format!("{base}/renamed"))
        .await
        .unwrap();
    ops::chmod(&sftp, &format!("{base}/renamed"), 0o750)
        .await
        .unwrap();
    let entries = ops::list(&sftp, &base).await.unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].name, "renamed");
    assert_eq!(entries[0].permissions, Some(0o750));

    let too_big = ops::chmod(&sftp, &format!("{base}/renamed"), 0o17777)
        .await
        .unwrap_err();
    assert_eq!(too_big.kind, ErrorKind::Validation);

    ops::remove(&sftp, &base).await.unwrap();
    link.disconnect().await;
}

#[tokio::test]
async fn a_recursive_removal_counts_first_and_never_follows_a_link() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let (link, sftp, base) = sftp(&env, dir.path()).await;

    // Outside the tree: must survive the removal of a link that points to it.
    let outside = format!("{base}/keep");
    ops::mkdir(&sftp, &outside).await.unwrap();
    put(&sftp, &format!("{outside}/precious"), b"x").await;

    let tree = format!("{base}/tree");
    ops::mkdir(&sftp, &tree).await.unwrap();
    ops::mkdir(&sftp, &format!("{tree}/sub")).await.unwrap();
    put(&sftp, &format!("{tree}/one"), b"1").await;
    put(&sftp, &format!("{tree}/sub/two"), b"2").await;
    link_to(&sftp, &outside, &format!("{tree}/to-keep")).await;

    // tree, sub, one, two, to-keep: the link counts as one entry, its target is not entered.
    assert_eq!(ops::count(&sftp, &tree).await.unwrap(), 5);
    assert_eq!(ops::count(&sftp, &format!("{tree}/one")).await.unwrap(), 1);

    ops::remove(&sftp, &tree).await.unwrap();
    let left: Vec<String> = ops::list(&sftp, &base)
        .await
        .unwrap()
        .into_iter()
        .map(|e| e.name)
        .collect();
    assert_eq!(left, ["keep"]);
    let kept = ops::list(&sftp, &outside).await.unwrap();
    assert_eq!(kept.len(), 1, "the link's target is untouched");

    let root = ops::remove(&sftp, "/").await.unwrap_err();
    assert_eq!(root.kind, ErrorKind::Validation);
    let missing = ops::list(&sftp, &format!("{base}/nope")).await.unwrap_err();
    assert_eq!(missing.kind, ErrorKind::NotFound);

    ops::remove(&sftp, &base).await.unwrap();
    link.disconnect().await;
}

#[tokio::test]
async fn an_sftp_tab_from_the_first_step_to_the_close() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let target = target(&env);
    let ctx = ctx_for(&env, dir.path(), &target).await;
    let registry = Arc::new(SftpRegistry::default());
    let recorder = Arc::new(Recorder::default());
    let cancel = CancellationToken::new();
    let id = Uuid::new_v4();
    let run = SftpRun {
        id,
        target,
        cancel: cancel.clone(),
    };
    let sink: Arc<dyn SessionSink> = recorder.clone();
    let task = tokio::spawn(run_sftp_session(ctx, run, sink, registry.clone()));

    for _ in 0..500 {
        if recorder.events().contains(&SessionEvent::Connected) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let events = recorder.events();
    assert_eq!(
        events[events.len() - 3..],
        [
            SessionEvent::Step {
                step: StepKind::Open,
                label: "sftp".into(),
                state: StepState::Started,
            },
            SessionEvent::Step {
                step: StepKind::Open,
                label: "sftp".into(),
                state: StepState::Done,
            },
            SessionEvent::Connected,
        ]
    );
    let session = registry.get(id).expect("registered while connected");
    assert!(ops::realpath(&session, ".").await.is_ok());
    drop(session);

    cancel.cancel();
    tokio::time::timeout(Duration::from_secs(10), task)
        .await
        .expect("the tab ends")
        .unwrap();
    assert_eq!(
        recorder.events().last(),
        Some(&SessionEvent::Closed {
            reason: CloseReason::UserClosed,
            exit_status: None,
        })
    );
    let gone = registry.get(id).err().expect("removed once closed");
    assert_eq!(gone.kind, ErrorKind::NotFound);
}
```

### `src/lib/mock/sftp.test.ts` (nouveau)

```ts
// T24: the mock's SFTP tabs and file system, which the explorer of T25 is built against.
import { beforeEach, describe, expect, test } from "vitest";
import type { SessionEvent } from "@/bindings/SessionEvent";
import { toAppError } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import { resetMockBackend } from "@/lib/ipc-mock";
import { MOCK_IDS } from "@/lib/mock/data";

beforeEach(() => {
  resetMockBackend();
});

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return toAppError(error);
  }
  throw new Error("expected a rejection");
}

/** Open an SFTP tab on `connectionId` and wait until it is connected; returns its id and its events. */
async function openTab(connectionId: string) {
  const id = crypto.randomUUID();
  const events: SessionEvent[] = [];
  await new Promise<void>((resolve) => {
    void ipc.sftpOpen(id, { type: "saved", connectionId }, (event) => {
      events.push(event);
      if (event.type === "connected") resolve();
    });
  });
  return { id, events };
}

describe("mock sftp_open", () => {
  test("goes through the connecting steps, then opens the sftp subsystem", async () => {
    const { events } = await openTab(MOCK_IDS.nas);
    const steps = events.filter((e) => e.type === "step").map((e) => `${e.step}:${e.state}`);
    expect(steps.slice(0, 2)).toEqual(["target:started", "target:done"]);
    expect(steps.slice(-2)).toEqual(["open:started", "open:done"]);
    expect(events.at(-1)).toEqual({ type: "connected" });
  });

  test("goes through the bastion first", async () => {
    const { events } = await openTab(MOCK_IDS.web01);
    expect(events[0]).toEqual({ type: "step", step: "hop", label: "bastion-01", state: "started" });
  });
});

describe("mock sftp operations", () => {
  test("the home directory and its listing", async () => {
    const { id } = await openTab(MOCK_IDS.nas);
    const home = await ipc.sftpRealpath(id, ".");
    expect(home).toBe("/home/admin");
    const entries = await ipc.sftpList(id, home);
    expect(entries.map((e) => [e.name, e.kind, e.hidden])).toEqual([
      [".bashrc", "file", true],
      ["backup.tar.gz", "file", false],
      ["current", "symlink", false],
      ["notes.txt", "file", false],
      ["projects", "dir", false],
    ]);
    expect(entries[4].path).toBe("/home/admin/projects");
    expect(await ipc.sftpRealpath(id, "/home/admin/projects/../projects/")).toBe(
      "/home/admin/projects",
    );
  });

  test("mkdir, rename, chmod, count and remove", async () => {
    const { id } = await openTab(MOCK_IDS.nas);
    await ipc.sftpMkdir(id, "/home/admin/new");
    await ipc.sftpRename(id, "/home/admin/projects", "/home/admin/code");
    expect(await ipc.sftpCount(id, "/home/admin/code")).toBe(4);
    await ipc.sftpChmod(id, "/home/admin/new", 0o700);
    const names = (await ipc.sftpList(id, "/home/admin")).map((e) => e.name);
    expect(names).toContain("new");
    expect(names).toContain("code");
    expect(names).not.toContain("projects");
    const created = (await ipc.sftpList(id, "/home/admin")).find((e) => e.name === "new");
    expect(created?.permissions).toBe(0o700);

    await ipc.sftpRemove(id, "/home/admin/code");
    expect((await ipc.sftpList(id, "/home/admin")).map((e) => e.name)).not.toContain("code");
    expect((await rejection(ipc.sftpList(id, "/home/admin/code/app"))).kind).toBe("notFound");
  });

  test("the backend's refusals", async () => {
    const { id } = await openTab(MOCK_IDS.nas);
    expect((await rejection(ipc.sftpMkdir(id, "/home/admin/projects"))).kind).toBe("sftp");
    expect((await rejection(ipc.sftpList(id, "relative"))).kind).toBe("validation");
    expect((await rejection(ipc.sftpRemove(id, "/"))).kind).toBe("validation");
    expect((await rejection(ipc.sftpChmod(id, "/home/admin/notes.txt", 0o17777))).kind).toBe(
      "validation",
    );
  });

  test("a closed tab, or one never opened, has no session", async () => {
    const { id } = await openTab(MOCK_IDS.nas);
    await ipc.sessionClose(id);
    expect((await rejection(ipc.sftpList(id, "/"))).kind).toBe("notFound");
    expect((await rejection(ipc.sftpList(crypto.randomUUID(), "/"))).kind).toBe("notFound");
  });
});
```

## Étapes

1. Les tests : `node scripts/contract-tests.mjs T24`.
2. `Cargo.toml`, `sftp/mod.rs`, `sftp/ops.rs` : `cd src-tauri && cargo test --lib sftp` jusqu'au vert.
3. `sftp/session.rs`, `state.rs`, `commands/sftp.rs`, `commands/mod.rs`, `lib.rs` :
   `cargo test --lib commands::ipc_sftp`, puis `npm run test:ssh` (`ssh_sftp` compris) et `npm run bindings`.
4. `ipc.ts`, `lib/mock/sessions.ts` (`connectSteps`), `lib/mock/sftp-fs.ts`, `lib/mock/sftp.ts`, `ipc-mock.ts` :
   `npx vitest run src/lib`.
5. `npm run format`, `npm run review`, cases, statut, commit `feat: SFTP backend, commands and mock (T24)`.

## Critères d'acceptation

- [ ] `npm run review` passe (avec `test:ssh`), et `node scripts/contract-tests.mjs T24 --check` affiche `OK`
      partout.
- [ ] `grep -rn "error_message" src-tauri/src/sftp` ne trouve rien (le texte du serveur n'est jamais recopié, S7).
- [x] `grep -n "fn metadata\|\.metadata(" src-tauri/src/sftp/ops.rs` ne montre que `entry.metadata()` (les attributs
      de `read_dir`), jamais `sftp.metadata(` (qui suivrait un lien).
- [x] Aucune nouvelle exception `project-rules: allow`.

## À regarder par Florian

Rien à l'écran encore : l'onglet SFTP arrive avec T25.
