# T57 — SFTP : éditer un fichier distant — moteur

| | |
|---|---|
| **Jalon** | M10 — Nouvelles fonctions (lot 8) |
| **Dépend de** | T56 |
| **Lire avant** | `docs/10-fonctions-a-venir.md` § « SFTP : éditer un fichier distant » ; `docs/02-decisions.md` § D17 ; `docs/06-securite.md` S7, S8, S9, S11 ; `docs/01-architecture.md` § 6 (IPC, `Channel`) |
| **Livrable** | `src-tauri/src/sftp/edit.rs` (nouveau, + `edit_watch.rs` si besoin), `sftp/mod.rs`, `paths.rs` (`edit_dir`), `state.rs` (`edits`), `commands/edit.rs` (nouveau), `commands/sftp.rs` (fin d'onglet), `lib.rs` (démarrage, `invoke_handler`), bindings ; `src/lib/ipc.ts`, `src/lib/mock/` (édition) ; `src-tauri/tests/ssh_edit.rs`, `src-tauri/src/commands/ipc_edit_tests.rs` |

## Pourquoi

Modifier un fichier de configuration sur un serveur demande aujourd'hui de le télécharger, l'éditer, puis le renvoyer à
la main, sans garde-fou si quelqu'un l'a changé entre-temps. Ici le moteur : télécharger dans un dossier privé,
ouvrir avec l'application par défaut, renvoyer à chaque enregistrement, refuser d'écraser une version plus récente.
L'interface vient en T57b.

## À réutiliser (ne pas réécrire)

- `ops.rs` : `validate_remote_path`, `valid_name`, `map_sftp_error` ; `transfer.rs` : `copy`, `local_io_error`.
- `SftpRegistry::get` (la session de l'onglet), `TransferRegistry` comme modèle d'un registre de jetons.
- Le plugin `opener` côté Rust : `use tauri_plugin_opener::OpenerExt; app.opener().open_path(path, None::<&str>)`.
  Un appel Rust ne passe pas par les capacités JS : `capabilities/default.json` ne change pas.

## Contrat — Rust

### Dossier privé

- `AppPaths` gagne `edit_dir: Option<PathBuf>` : `<runtime_dir>/tunl/edit` (`app.path().runtime_dir()`, soit
  `$XDG_RUNTIME_DIR`). Pas de dossier d'exécution : `None`, et toute édition est refusée
  (`AppError::new(ErrorKind::Io, "no private runtime directory")`). **Jamais** de repli sur `/tmp`.
- Au démarrage (`setup`), `clear_edits(&dir)` efface tout le dossier d'édition (restes d'une session plantée).
- Dossiers créés en `0700` (`tunl`, `edit`, et `<edit_id>`), fichier en `0600`, fixés à la création (S9).

### `sftp::edit`

```rust
/// What the remote file looked like when last read or written. Another value means someone else wrote it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RemoteStamp {
    pub size: u64,
    pub mtime: u32,
}

/// Why a push did not happen.
#[derive(Debug)]
pub enum PushError {
    /// The remote file changed since `expected`: nothing was written.
    Conflict,
    Failed(AppError),
}

/// The remote file's stamp (`metadata`, which follows a link like the download does).
pub async fn stamp(sftp: &SftpSession, remote: &str) -> AppResult<RemoteStamp>;

/// Download `remote` to `<edit_dir>/<edit_id>/<base name>` (folders 0700, file 0600), and its stamp.
pub async fn fetch(
    sftp: &SftpSession,
    remote: &str,
    edit_dir: &Path,
    edit_id: Uuid,
) -> AppResult<(PathBuf, RemoteStamp)>;

/// Write `local` over `remote`, **in place**, then return the new stamp. With `Some(expected)`, the remote stamp is
/// read first: another value gives `PushError::Conflict` and nothing is written. `None` writes anyway.
pub async fn push(
    sftp: &SftpSession,
    local: &Path,
    remote: &str,
    expected: Option<RemoteStamp>,
) -> Result<RemoteStamp, PushError>;

/// Remove the whole edit folder, if it exists.
pub fn clear_edits(edit_dir: &Path) -> std::io::Result<()>;
```

- **En place** : `open_with_flags(remote, WRITE | TRUNCATE)` (sans `CREATE` : un fichier supprimé entre-temps donne
  une erreur, pas un nouveau fichier), `copy`, `shutdown`. Pas de `.part` ici : un `rename` sur un fichier existant
  échoue en SFTP v3, et remplacer le fichier perdrait ses droits, son propriétaire et ses liens (décision D17).
- Le nom de base vient du chemin distant et passe par `valid_name` (S11) ; sinon `AppError::validation("path", …)`.

### Surveillance et événements

```rust
/// What happens to one edit, sent to the UI through its `Channel` (T57).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[ts(export)]
pub enum EditEvent {
    /// Downloaded and handed to the default application.
    Opened { local_path: String },
    /// A local save reached the server.
    Saved,
    /// The remote file changed since it was opened or last saved: waiting for `sftp_edit_resolve`.
    Conflict,
    /// A save could not be sent; the next local save tries again.
    Failed { error: AppError },
    /// The edit ended (its tab closed): the local copy is gone.
    Closed,
}
```

- Une tâche par édition sonde le fichier local toutes les `EDIT_POLL = 1 s` (taille et date de modification ; pas de
  dépendance de surveillance de fichiers). Un changement est envoyé quand la valeur est **stable sur deux sondages de
  suite** et diffère de la dernière envoyée (un éditeur qui écrit en plusieurs fois n'envoie qu'une fois).
- Envoi : `push(…, Some(dernier stamp))`. `Ok` → `Saved`, le stamp est retenu. `Conflict` → `Conflict`, puis la tâche
  attend la réponse (`sftp_edit_resolve`) sans renvoyer : `overwrite = true` → `push(…, None)` puis `Saved` ;
  `false` → rien n'est envoyé, l'ancien stamp est gardé (le prochain enregistrement redemandera). `Failed` → `Failed`,
  la surveillance continue.
- `EditRegistry` (dans `AppState`, `edits`) : par `edit_id`, l'onglet (`session_id`), le jeton d'annulation et l'envoi
  des réponses. `close_session(session_id)` annule les éditions de l'onglet, efface leur dossier `<edit_id>` et
  émet `Closed`. Il est appelé là où l'onglet SFTP se termine (la tâche de `sftp_open`, après `sftp.remove`).

### Commandes (`commands/edit.rs`, dans `invoke_handler()` et `ipc_edit_tests.rs`)

```rust
#[tauri::command]
pub async fn sftp_edit<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    session_id: Uuid,
    edit_id: Uuid,
    remote_path: String,
    on_event: Channel<EditEvent>,
) -> AppResult<()>;

#[tauri::command]
pub async fn sftp_edit_resolve(state: State<'_, AppState>, edit_id: Uuid, overwrite: bool) -> AppResult<()>;
```

- `sftp_edit` : onglet connecté (`notFound` sinon), chemin validé, `edit_dir` présent ; `fetch` **avant** de répondre
  (une erreur de téléchargement revient à l'appel) ; puis `open_path`, `Opened`, et la tâche de surveillance. Un
  `open_path` raté : `Failed` (le fichier local reste, la surveillance tourne quand même).
- `sftp_edit_resolve` : une édition inconnue ou qui n'attend pas de réponse n'est pas une erreur.

### Frontend minimal (l'interface est en T57b)

- `ipc.ts` : `sftpEdit(sessionId, editId, remotePath, onEvent)` (le `Channel` construit comme pour les transferts) et
  `sftpEditResolve(editId, overwrite)` ; les deux dans le mock.
- **Mock** : `sftp_edit` refuse un onglet non connecté (`notFound`) et une entrée qui n'est pas un fichier
  (`validation`) ; sinon `opened` (chemin `/run/user/1000/tunl/edit/<editId>/<nom>`), puis 300 ms plus tard `saved`,
  sauf pour un fichier nommé `.bashrc` : `conflict`. `sftp_edit_resolve` avec `overwrite` sur une édition en
  conflit : `saved` ; sans : rien.

## Pièges

- S8 : jamais un octet du fichier dans un journal. Le chemin local et le chemin distant sont permis.
- `std::fs::set_permissions` **après** la création laisse une fenêtre : créer avec `OpenOptions::mode(0o600)` et
  `DirBuilder::mode(0o700)` (`std::os::unix::fs`).
- Le `mtime` SFTP est en secondes : deux écritures dans la même seconde avec la même taille ne se distinguent pas.
  C'est accepté (la taille change presque toujours) ; ne pas comparer le contenu.
- La tâche de surveillance tient un `Arc<SftpSession>` : elle doit s'arrêter avec l'onglet (`close_session`), sinon
  elle sonde un fichier pour une session fermée.
- `lib.rs` et `state.rs` approchent peut-être 400 lignes : si besoin, l'`EditRegistry` vit dans `sftp/edit_registry.rs`.

## Tests du contrat

### `src-tauri/tests/ssh_edit.rs` (nouveau)

```rust
//! T57 against the podman target: a remote file is fetched into a private folder, pushed back in place (its
//! permissions kept), and never written over a newer remote version without being asked. `npm run test:ssh`.
#![cfg(feature = "test-env")]

mod support;

use std::os::unix::fs::PermissionsExt;
use std::sync::Arc;
use std::time::Duration;

use russh_sftp::client::SftpSession;
use support::{TestEnv, context, respond};
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;
use tunl_lib::prompts::PromptBroker;
use tunl_lib::secrets::{SecretKind, SecretStore, SecretValue};
use tunl_lib::sessions::{SessionEvent, SessionSink};
use tunl_lib::sftp::edit::{PushError, clear_edits, fetch, push, stamp};
use tunl_lib::sftp::ops;
use tunl_lib::sftp::session::open_sftp;
use tunl_lib::ssh::auth::AuthPlan;
use tunl_lib::ssh::link::{SshLink, establish};
use tunl_lib::ssh::session::SshTarget;
use uuid::Uuid;

struct Quiet;

impl SessionSink for Quiet {
    fn event(&self, _event: SessionEvent) {}
    fn output(&self, _bytes: Vec<u8>) {}
}

/// A link to the target, its SFTP session, and a fresh remote directory holding `app.conf` (mode 0640).
async fn sftp(env: &TestEnv, dir: &std::path::Path) -> (SshLink, SftpSession, String) {
    let target = SshTarget {
        connection_id: Some(Uuid::new_v4()),
        connection_name: "target".into(),
        host: env.host("target"),
        port: env.port("target"),
        username: env.user(),
        plan: AuthPlan::Password,
        connect_timeout: Duration::from_secs(5),
        keepalive_secs: 15,
        jump_hosts: Vec::new(),
    };
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
    let ctx = context(env, dir, broker, secrets);
    let link = establish(&ctx, &target, Uuid::new_v4(), CancellationToken::new(), &Quiet)
        .await
        .expect("a link to the target");
    let sftp = open_sftp(&link.target).await.unwrap();
    let base = format!("/tmp/tunl-edit-{}", Uuid::new_v4());
    ops::mkdir(&sftp, &base).await.unwrap();
    let mut file = sftp.create(format!("{base}/app.conf")).await.unwrap();
    file.write_all(b"port = 80\n").await.unwrap();
    file.shutdown().await.unwrap();
    ops::chmod(&sftp, &format!("{base}/app.conf"), 0o640).await.unwrap();
    (link, sftp, base)
}

fn mode(path: &std::path::Path) -> u32 {
    std::fs::metadata(path).unwrap().permissions().mode() & 0o777
}

#[tokio::test]
async fn a_file_is_fetched_privately_then_pushed_back_in_place() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let (link, sftp, base) = sftp(&env, dir.path()).await;
    let edit_dir = dir.path().join("run").join("tunl").join("edit");
    let remote = format!("{base}/app.conf");

    let id = Uuid::new_v4();
    let (local, first) = fetch(&sftp, &remote, &edit_dir, id).await.unwrap();
    assert_eq!(local, edit_dir.join(id.to_string()).join("app.conf"));
    assert_eq!(std::fs::read(&local).unwrap(), b"port = 80\n");
    assert_eq!(mode(&local), 0o600);
    assert_eq!(mode(local.parent().unwrap()), 0o700);
    assert_eq!(mode(&edit_dir), 0o700);
    assert_eq!(first.size, 10);

    std::fs::write(&local, b"port = 8080\n").unwrap();
    let second = push(&sftp, &local, &remote, Some(first)).await.unwrap();
    assert_eq!(second.size, 12);
    assert_eq!(sftp.read(remote.clone()).await.unwrap(), b"port = 8080\n");
    let remote_mode = sftp.metadata(remote.clone()).await.unwrap().permissions.unwrap() & 0o777;
    assert_eq!(remote_mode, 0o640, "an in-place write keeps the permissions");
    assert_eq!(stamp(&sftp, &remote).await.unwrap(), second);

    clear_edits(&edit_dir).unwrap();
    assert!(!edit_dir.exists());
    ops::remove(&sftp, &base).await.unwrap();
    link.disconnect().await;
}

#[tokio::test]
async fn a_newer_remote_version_is_never_overwritten_unasked() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let (link, sftp, base) = sftp(&env, dir.path()).await;
    let edit_dir = dir.path().join("edit");
    let remote = format!("{base}/app.conf");

    let (local, opened) = fetch(&sftp, &remote, &edit_dir, Uuid::new_v4()).await.unwrap();
    // Someone else writes the file on the server meanwhile.
    sftp.write(remote.clone(), b"port = 443 # theirs\n").await.unwrap();
    std::fs::write(&local, b"port = 8080\n").unwrap();

    match push(&sftp, &local, &remote, Some(opened)).await {
        Err(PushError::Conflict) => {}
        other => panic!("a changed remote file must be a conflict, got {other:?}"),
    }
    assert_eq!(sftp.read(remote.clone()).await.unwrap(), b"port = 443 # theirs\n");

    push(&sftp, &local, &remote, None).await.unwrap();
    assert_eq!(sftp.read(remote.clone()).await.unwrap(), b"port = 8080\n");

    sftp.remove_file(remote.clone()).await.unwrap();
    assert!(
        push(&sftp, &local, &remote, None).await.is_err(),
        "a file deleted on the server is not created again"
    );

    ops::remove(&sftp, &base).await.unwrap();
    link.disconnect().await;
}
```

### `src-tauri/src/commands/ipc_edit_tests.rs` (nouveau)

```rust
//! `sftp_edit` and `sftp_edit_resolve` (T57) through Tauri's real IPC layer, with the keys sent by `ipc.ts`.
use serde_json::json;

use super::ipc_tests::{invoke, mock_app, ok};

#[test]
fn edit_commands_accept_the_arguments_sent_by_ipc_ts() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());
    let session = "5b6f2d3e-0000-4000-8000-000000000071";
    let edit = "5b6f2d3e-0000-4000-8000-000000000072";

    // No SFTP tab is connected: the arguments were read, the session was not found.
    let error = invoke(
        &webview,
        "sftp_edit",
        json!({
            "sessionId": session,
            "editId": edit,
            "remotePath": "/etc/app.conf",
            "onEvent": "__CHANNEL__:1"
        }),
    )
    .unwrap_err();
    assert_eq!(error["kind"], "notFound", "{error}");

    // Answering an unknown edit is not an error.
    ok(
        &webview,
        "sftp_edit_resolve",
        json!({ "editId": edit, "overwrite": true }),
    );
}
```

### `src-tauri/src/commands/ipc_tests.rs` (remplace la version de T12 : champ `edit_dir` d'AppPaths en plus)

```rust
//! Drives every command through Tauri's real IPC layer (`tauri::test`, `MockRuntime`), with **exactly** the
//! argument objects that `src/lib/ipc.ts` sends. The browser mock cannot catch a mismatch between a JS key and
//! a Rust parameter name: this test does. Any command added to `ipc.ts` gets a line here, or in an
//! `ipc_<domain>_tests.rs` beside this file that reuses these `pub(crate)` helpers.
use std::path::Path;

use serde_json::{Value, json};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{
    INVOKE_KEY, MockRuntime, get_ipc_response, mock_builder, mock_context, noop_assets,
};
use tauri::webview::InvokeRequest;
use tauri::{Manager, WebviewWindow, WebviewWindowBuilder};

use crate::paths::AppPaths;
use crate::secrets::SecretStore;
use crate::state::AppState;

pub(crate) fn mock_app(dir: &Path) -> (tauri::App<MockRuntime>, WebviewWindow<MockRuntime>) {
    let paths = AppPaths {
        config_dir: dir.join("config"),
        data_dir: dir.join("data"),
        log_dir: dir.join("logs"),
        edit_dir: None,
    };
    paths.ensure_created().unwrap();
    let state = AppState::from_disk(&paths, 1_700_000_000_000, SecretStore::memory()).unwrap();
    let app = mock_builder()
        .invoke_handler(crate::invoke_handler())
        .build(mock_context(noop_assets()))
        .unwrap();
    app.manage(state);
    let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    (app, webview)
}

/// `invoke(cmd, args)` as the frontend does it; the error is the serialized `AppError` (or Tauri's own message).
pub(crate) fn invoke(
    webview: &WebviewWindow<MockRuntime>,
    cmd: &str,
    args: Value,
) -> Result<Value, Value> {
    get_ipc_response(
        webview,
        InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "tauri://localhost".parse().unwrap(),
            body: InvokeBody::Json(args),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .map(|body| body.deserialize::<Value>().unwrap())
}

pub(crate) fn ok(webview: &WebviewWindow<MockRuntime>, cmd: &str, args: Value) -> Value {
    invoke(webview, cmd, args).unwrap_or_else(|error| panic!("{cmd} failed: {error}"))
}

pub(crate) fn create_connection(webview: &WebviewWindow<MockRuntime>, name: &str) -> Value {
    let templates = ok(webview, "connection_templates", json!({}));
    let mut input = templates["ssh"].clone();
    input["name"] = json!(name);
    input["host"] = json!("10.0.0.1");
    ok(webview, "connection_create", json!({ "input": input }))
}

#[test]
fn every_command_accepts_the_arguments_sent_by_ipc_ts() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());

    ok(&webview, "app_info", json!({}));
    ok(&webview, "store_load", json!({}));
    let templates = ok(&webview, "connection_templates", json!({}));

    let mut input = templates["ssh"].clone();
    input["name"] = json!("web-01");
    input["host"] = json!("10.0.0.1");
    let created = ok(&webview, "connection_create", json!({ "input": input }));
    let id = created["id"].clone();

    input["name"] = json!("web-01b");
    let updated = ok(
        &webview,
        "connection_update",
        json!({ "id": id, "input": input }),
    );
    assert_eq!(updated["name"], "web-01b");
    ok(
        &webview,
        "connection_set_favorite",
        json!({ "id": id, "favorite": true }),
    );
    ok(&webview, "connection_touch", json!({ "id": id }));
    let copy = ok(&webview, "connection_duplicate", json!({ "id": id }));
    ok(&webview, "connection_delete", json!({ "id": copy["id"] }));

    let group = ok(
        &webview,
        "group_create",
        json!({ "input": { "name": "Prod", "color": null } }),
    );
    let group_id = group["id"].clone();
    ok(
        &webview,
        "group_update",
        json!({ "id": group_id, "input": { "name": "Production", "color": "teal" } }),
    );
    ok(&webview, "group_reorder", json!({ "ids": [group_id] }));
    ok(&webview, "group_delete", json!({ "id": group_id }));

    let settings = ok(&webview, "settings_get", json!({}));
    ok(&webview, "settings_update", json!({ "settings": settings }));

    ok(
        &webview,
        "secret_set",
        json!({ "connectionId": id, "kind": "password", "value": "hunter2" }),
    );
    assert_eq!(
        ok(
            &webview,
            "secret_has",
            json!({ "connectionId": id, "kind": "password" })
        ),
        json!(true)
    );
    ok(
        &webview,
        "secret_delete",
        json!({ "connectionId": id, "kind": "password" }),
    );
    assert_eq!(
        ok(
            &webview,
            "secret_has",
            json!({ "connectionId": id, "kind": "password" })
        ),
        json!(false)
    );

    let snapshot = ok(&webview, "store_load", json!({}));
    assert_eq!(snapshot["connections"].as_array().unwrap().len(), 1);
}

#[test]
fn a_backend_error_reaches_the_frontend_as_an_app_error() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());
    let error = invoke(
        &webview,
        "connection_delete",
        json!({ "id": uuid::Uuid::new_v4() }),
    )
    .unwrap_err();
    assert_eq!(error["kind"], "notFound");
}

#[test]
fn secrets_follow_their_connection_and_never_reach_the_store() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());
    let id = create_connection(&webview, "db")["id"].clone();

    let unknown = uuid::Uuid::new_v4();
    let missing = invoke(
        &webview,
        "secret_set",
        json!({ "connectionId": unknown, "kind": "password", "value": "x" }),
    );
    assert_eq!(missing.unwrap_err()["kind"], "notFound");
    let empty = invoke(
        &webview,
        "secret_set",
        json!({ "connectionId": id, "kind": "password", "value": "" }),
    );
    assert_eq!(empty.unwrap_err()["kind"], "validation");

    ok(
        &webview,
        "secret_set",
        json!({ "connectionId": id, "kind": "passphrase", "value": "hunter2" }),
    );
    let copy = ok(&webview, "connection_duplicate", json!({ "id": id }));
    assert_eq!(
        ok(
            &webview,
            "secret_has",
            json!({ "connectionId": copy["id"], "kind": "passphrase" })
        ),
        json!(false)
    );

    let on_disk =
        std::fs::read_to_string(dir.path().join("config").join("connections.json")).unwrap();
    assert!(!on_disk.contains("hunter2"));
    assert!(
        !ok(&webview, "store_load", json!({}))
            .to_string()
            .contains("hunter2")
    );

    ok(&webview, "connection_delete", json!({ "id": id }));
    assert_eq!(
        ok(
            &webview,
            "secret_has",
            json!({ "connectionId": id, "kind": "passphrase" })
        ),
        json!(false)
    );
}
```
### `src-tauri/src/reload_tests.rs` (remplace la version de T30b : champ `edit_dir` d'AppPaths en plus)

```rust
//! T30b: reloading the page ends what the old page was running (sessions, transfers, prompts).
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::error::ErrorKind;
use crate::paths::AppPaths;
use crate::prompts::{PromptBroker, PromptKind};
use crate::secrets::SecretStore;
use crate::sessions::{SessionHandle, SessionRegistry};
use crate::sftp::TransferRegistry;
use crate::state::AppState;

fn handle() -> SessionHandle {
    let (input, _receiver) = mpsc::unbounded_channel();
    SessionHandle {
        cancel: CancellationToken::new(),
        input,
    }
}

fn host_key() -> PromptKind {
    PromptKind::HostKeyUnknown {
        host: "db.internal".into(),
        port: 22,
        key_type: "ssh-ed25519".into(),
        fingerprint: "SHA256:abc".into(),
    }
}

#[test]
fn close_all_cancels_and_forgets_every_session() {
    let registry = SessionRegistry::new();
    let (first, second) = (handle(), handle());
    let tokens = [first.cancel.clone(), second.cancel.clone()];
    registry.insert(Uuid::new_v4(), first).unwrap();
    registry.insert(Uuid::new_v4(), second).unwrap();

    assert_eq!(registry.close_all(), 2);
    assert!(registry.is_empty());
    assert!(tokens.iter().all(CancellationToken::is_cancelled));
    assert_eq!(registry.close_all(), 0);
}

#[test]
fn cancel_all_cancels_every_transfer() {
    let transfers = TransferRegistry::default();
    let tokens = [CancellationToken::new(), CancellationToken::new()];
    for token in &tokens {
        transfers.insert(Uuid::new_v4(), token.clone()).unwrap();
    }
    transfers.cancel_all();
    assert!(tokens.iter().all(CancellationToken::is_cancelled));
}

#[tokio::test]
async fn cancel_all_ends_every_pending_prompt_as_cancelled() {
    let broker = Arc::new(PromptBroker::with_timeout(Duration::from_secs(5)));
    broker.set_emitter(Box::new(|_| {}));
    let asks: Vec<_> = [Some(Uuid::new_v4()), None]
        .into_iter()
        .map(|session| {
            let broker = broker.clone();
            tokio::spawn(async move { broker.ask(session, host_key()).await })
        })
        .collect();
    for _ in 0..400 {
        if broker.pending_count() == 2 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    assert_eq!(broker.pending_count(), 2);

    broker.cancel_all();
    for ask in asks {
        assert_eq!(ask.await.unwrap().unwrap_err().kind, ErrorKind::Cancelled);
    }
    assert_eq!(broker.pending_count(), 0);
}

#[test]
fn end_all_sessions_reports_how_many_were_open() {
    let dir = tempfile::tempdir().unwrap();
    let paths = AppPaths {
        config_dir: dir.path().join("config"),
        data_dir: dir.path().join("data"),
        log_dir: dir.path().join("logs"),
        edit_dir: None,
    };
    paths.ensure_created().unwrap();
    let state = AppState::from_disk(&paths, 1_000, SecretStore::memory()).unwrap();
    let session = handle();
    let token = session.cancel.clone();
    state.sessions.insert(Uuid::new_v4(), session).unwrap();

    assert_eq!(state.end_all_sessions(), 1);
    assert!(token.is_cancelled());
    assert_eq!(state.end_all_sessions(), 0);
}
```
## Étapes

1. Les tests : `node scripts/contract-tests.mjs T57`.
2. `sftp/edit.rs` (`stamp`, `fetch`, `push`, `clear_edits`) : `cd src-tauri && cargo test --lib sftp`.
3. `paths.rs`, `state.rs`, registre, surveillance, `commands/edit.rs`, `lib.rs`, `commands/sftp.rs` :
   `cargo test --lib commands`, `npm run bindings`, puis `npm run test:ssh` (pas pendant un job `dev`).
4. `ipc.ts`, mock : `npm run typecheck`, `npx vitest run src/lib`.
5. `npm run format`, `npm run review`, cases, statut, commit
   `feat: edit a remote file in a private folder, pushed back on each save (T57)`.

## Critères d'acceptation

- [x] `npm run review` passe (avec `test:ssh`), et `node scripts/contract-tests.mjs T57 --check` affiche `OK` partout.
- [x] `grep -rn "/tmp" src-tauri/src/sftp/edit*.rs src-tauri/src/paths.rs` ne trouve rien.
- [x] `grep -n "sftp_edit" src-tauri/src/lib.rs` trouve les deux commandes.
- [x] Aucune nouvelle exception `project-rules: allow`.

## À regarder par Florian

Rien à l'écran avant T57b. Dans `npm run tauri dev`, après un démarrage : `ls -ld $XDG_RUNTIME_DIR/tunl` n'existe pas
ou est vide (le dossier d'édition est effacé au lancement).
