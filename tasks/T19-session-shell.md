# T19 — Session shell : PTY, flux d'octets, registre de sessions, `ssh_open` / `write` / `resize` / `close`

| | |
|---|---|
| **Jalon** | M2 — SSH |
| **Dépend de** | T18 |
| **Lire avant** | `docs/01-architecture.md` §4.1, §4.2 et §6, `docs/06-securite.md` §2 (S8, S10) |
| **Livrable** | `sessions.rs`, `ssh/shell.rs`, `ssh/session.rs`, `commands/ssh.rs` ; `ipc.ts` (4 fonctions) et le mock des sessions ; 14 tests Rust, 2 tests IPC, 4 tests d'intégration, 12 tests Vitest |

## Pourquoi

T17, T17b et T18 savent ouvrir et authentifier une connexion. Il reste à y lancer un shell avec un pseudo-terminal, à
faire circuler les octets dans les deux sens, et à **suivre chaque session** (un onglet = une session = une
connexion SSH, D11) pour pouvoir lui écrire, la redimensionner et la fermer. Le frontend reçoit tout par deux
`Channel` Tauri passés à l'ouverture : les **événements** (étapes, connecté, fin, erreur) en JSON, et la **sortie**
du shell en octets bruts. Aucune interface ici : T20 et T21 s'en serviront, contre le mock écrit dans cette fiche.

Le PTY, le redimensionnement et le code de sortie ont été vérifiés au prototype contre le conteneur `target`.

## À réutiliser (ne pas réécrire)

- T17b : `tcp_connect`, `handshake`, `client_config`, `HostKeyTarget`, `SshContext`, `AppState::ssh_context` ;
  T18 : `authenticate`, `AuthTarget`, `plan_for`.
- `model::normalize_connection_input` et `ConnectionInput::template(Protocol::Ssh)` pour valider une cible rapide
  (hôte, port, utilisateur) exactement comme une connexion ; `SshDefaults` (`model`), `state.read_store()`,
  `state.get_settings()`.
- Mock : `Handler`, `arg`, `MockState` (`lib/mock/data.ts`), `MOCK_IDS`, `resetMockBackend` (`ipc-mock.ts`).

## Contrat — Rust

### Dépendance

```toml
tokio-util = "0.7"      # CancellationToken
```

### `src-tauri/src/sessions.rs` (déclaré `pub mod sessions;`, avec `#[cfg(test)] mod sessions_tests;` dans `lib.rs`)

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")] #[ts(export)]
pub enum SessionEvent {
    Step { step: StepKind, label: String, state: StepState },
    Connected,
    Log { line: String },                                      // RDP only (T28)
    Closed { reason: CloseReason, exit_status: Option<i32> },
    Error { error: AppError },
}
// Each: #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)] #[serde(rename_all = "camelCase")] #[ts(export)]
pub enum StepKind { Wake, Hop, Target, HostKey, Auth, Open, Launch }
pub enum StepState { Started, Done, Failed }
pub enum CloseReason { UserClosed, RemoteClosed, ProcessExited, Error }

/// Where a running session reports. Tauri: two Channels (commands/ssh.rs). Tests: a recorder.
pub trait SessionSink: Send + Sync + 'static {
    fn event(&self, event: SessionEvent);
    fn output(&self, bytes: Vec<u8>);
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShellInput { Data(Vec<u8>), Resize { cols: u32, rows: u32 } }

pub struct SessionHandle { pub cancel: CancellationToken, pub input: mpsc::UnboundedSender<ShellInput> }

#[derive(Default)]
pub struct SessionRegistry { /* std::sync::Mutex<HashMap<Uuid, SessionHandle>> */ }
impl SessionRegistry {
    pub fn new() -> Self;
    pub fn insert(&self, id: Uuid, handle: SessionHandle) -> AppResult<()>;  // taken → validation("sessionId", "is already open")
    pub fn send(&self, id: Uuid, input: ShellInput) -> AppResult<()>;        // unknown, or its task gone → not_found("session <id>")
    pub fn close(&self, id: Uuid) -> bool;     // cancels the token and forgets the session; false if unknown
    pub fn remove(&self, id: Uuid);            // the task, when it ends: forgets WITHOUT cancelling
    pub fn len(&self) -> usize;
    pub fn is_empty(&self) -> bool;
}
```

`AppState` : `pub sessions: Arc<SessionRegistry>` (dans `from_disk` et `blocked`).

### `src-tauri/src/ssh/shell.rs`

```rust
pub const OUTPUT_CHUNK: usize = 64 * 1024;       // S10: no single output message is larger
pub const TERM: &str = "xterm-256color";
pub fn validate_size(cols: u32, rows: u32) -> AppResult<()>;   // cols 1..=1000, rows 1..=500, else validation("cols" | "rows", "out of range")
pub async fn open_shell(handle: &Handle<ClientHandler>, cols: u32, rows: u32) -> AppResult<russh::Channel<russh::client::Msg>>;
pub async fn pump(channel: russh::Channel<russh::client::Msg>, input: mpsc::UnboundedReceiver<ShellInput>,
                  cancel: CancellationToken, sink: &dyn SessionSink) -> (CloseReason, Option<i32>);
```

- `open_shell` : `handle.channel_open_session()`, `channel.request_pty(true, TERM, cols, rows, 0, 0, &[])`,
  `channel.request_shell(true)`. Erreurs russh → `map_russh_error`.
- `pump` : `let (mut read, write) = channel.split();` puis une boucle `tokio::select!` sur trois sources :
  - `cancel.cancelled()` → `write.close()` (erreur ignorée), retour `(UserClosed, None)` ;
  - `read.wait()` : `ChannelMsg::Data { data }` et `ExtendedData { data, .. }` → `sink.output`, découpé en
    morceaux d'au plus `OUTPUT_CHUNK` ; `ExitStatus { exit_status }` → le retenir (`as i32`) ; `Eof` → rien ;
    `Close` ou `None` → retour `(RemoteClosed, code retenu)`. Ordre observé : `Eof`, `ExitStatus`, `Close` ;
  - `input.recv()` : `Data(bytes)` → `write.data_bytes(bytes)` ; `Resize { cols, rows }` →
    `write.window_change(cols, rows, 0, 0)` ; `None` → comme une annulation. Une erreur d'écriture → `(Error, None)`.
- **Jamais** les octets du terminal dans un log (S8).

### `src-tauri/src/ssh/session.rs`

```rust
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, TS)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")] #[ts(export)]
pub enum SessionTarget {
    Saved { connection_id: Uuid },
    Quick { host: String, port: u16, username: Option<String> },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SshTarget {
    pub connection_id: Option<Uuid>, pub connection_name: String,
    pub host: String, pub port: u16, pub username: String,
    pub plan: AuthPlan, pub connect_timeout: Duration, pub keepalive_secs: u32,
}

pub struct ShellSession {
    pub id: Uuid, pub target: SshTarget, pub cols: u32, pub rows: u32,
    pub input: mpsc::UnboundedReceiver<ShellInput>, pub cancel: CancellationToken,
}

pub fn default_username() -> Option<String>;     // $USER, else $LOGNAME (non-empty)
pub fn resolve_target(target: &SessionTarget, store: &Store, defaults: &SshDefaults, default_user: Option<&str>) -> AppResult<SshTarget>;
pub async fn run_ssh_session(ctx: SshContext, session: ShellSession, sink: Arc<dyn SessionSink>);
```

`resolve_target` :

| Cible | Règle |
|---|---|
| `Saved`, id absent du store | `AppError::not_found("connection <id>")` |
| `Saved`, connexion RDP | `AppError::validation("protocol", "is not SSH")` |
| `Saved`, `jump_host_id` renseigné | `AppError::validation("jumpHostId", "jump hosts are not supported yet")` — T22 lèvera cette limite |
| `Saved` | nom, hôte, port de la connexion ; `plan_for(&ssh.auth)` ; `keepalive_secs` et `connect_timeout` de la connexion s'ils sont renseignés, sinon ceux de `defaults` |
| `Quick` | validée par `normalize_connection_input` (nom = hôte, reste du gabarit SSH) : mêmes erreurs `validation` qu'un formulaire ; `connection_id: None`, `connection_name` = `"user@host"` (ou l'hôte seul sans utilisateur), `plan: Auto`, délais de `defaults` |
| Utilisateur | celui de la connexion (ou de la cible rapide), sinon `default_user`, sinon `AppError::validation("username", "is required")` |

`run_ssh_session` : chaque étape émet `Step { …, Started }` puis `Done` ou `Failed`, dans cet ordre exact :

| Étape | `label` | Travail |
|---|---|---|
| `Target` | `"<host>:<port>"` | `tcp_connect(host, port, connect_timeout)` |
| `HostKey` | `"<host>"` | `handshake(stream, HostKeyTarget { host, port, session_id: Some(id) }, client_config(keepalive_secs), &ctx)` |
| `Auth` | `"<username>"` | `authenticate(&mut handle, &AuthTarget { …, session_id: Some(id) }, &ctx)` |
| `Open` | `"shell"` | `open_shell(&handle, cols, rows)` |

Puis `Connected`, `pump(…)`, `Closed { reason, exit_status }`, et `handle.disconnect(Disconnect::ByApplication, "",
"en")` (erreur ignorée).
- Une étape échoue → `Step { …, Failed }` puis `Error { error }`, **et rien d'autre** (ni `Closed`).
- `cancel` pendant une étape (chaque attente est dans un `tokio::select!` avec `cancel.cancelled()`) → le futur de
  l'étape est abandonné (le prompt en cours disparaît du broker, T17) et on émet `Closed { UserClosed, None }`.

### Commandes : `src-tauri/src/commands/ssh.rs`

| Commande | Arguments (JS) | Retour | Règles |
|---|---|---|---|
| `ssh_open` | `{ sessionId, target, cols, rows, onEvent, onOutput }` | `()` | voir ci-dessous |
| `ssh_write` | `{ sessionId, data }` | `()` | `data: String`, envoyé en `ShellInput::Data(data.into_bytes())` ; session inconnue → `notFound` |
| `ssh_resize` | `{ sessionId, cols, rows }` | `()` | `validate_size` **d'abord**, puis `ShellInput::Resize` |
| `session_close` | `{ sessionId }` | `()` | `sessions.close(id)` et `prompts.cancel_session(id)` ; inconnue → `Ok` (idempotent) |

`ssh_open(state, session_id: Uuid, target: SessionTarget, cols: u32, rows: u32, on_event: Channel<SessionEvent>,
on_output: Channel<InvokeResponseBody>)` (`tauri::ipc::{Channel, InvokeResponseBody}`) :
1. `validate_size`, puis `resolve_target(&target, &store, &settings.ssh, default_username().as_deref())` : ces
   erreurs sont **renvoyées par la commande** (rien n'a démarré) ;
2. `sessions.insert(session_id, …)` (déjà pris → erreur renvoyée) ;
3. `tauri::async_runtime::spawn` d'une tâche qui lance `run_ssh_session`, puis `sessions.remove(id)` et
   `prompts.cancel_session(id)` ; la commande répond `Ok(())` **tout de suite**.

Le puits Tauri : une struct privée qui implémente `SessionSink` avec les deux `Channel` :
`events.send(event)` et `output.send(InvokeResponseBody::Raw(bytes))`. Un envoi qui échoue (fenêtre fermée) →
`log::debug!`, jamais de panique. Côté JS, un message brut arrive en `ArrayBuffer` (vérifié dans les sources de
Tauri 2.11 : petits messages par `eval`, gros par `fetch`).

Les quatre commandes dans `invoke_handler()`, et `#[cfg(test)] mod ipc_ssh_tests;` dans `commands/mod.rs`.

## Contrat — TypeScript

`npm run bindings` : `SessionEvent`, `StepKind`, `StepState`, `CloseReason`, `SessionTarget`.

### `src/lib/ipc.ts`

```ts
export interface SessionCallbacks { onEvent: (event: SessionEvent) => void; onOutput: (bytes: Uint8Array) => void }
export interface TerminalSize { cols: number; rows: number }

sshOpen: (sessionId: string, target: SessionTarget, size: TerminalSize, callbacks: SessionCallbacks) => Promise<void>,
  // call<void>("ssh_open", { sessionId, target, cols: size.cols, rows: size.rows, ...sessionChannels(callbacks) })
sshWrite: (sessionId: string, data: string) => Promise<void>,
sshResize: (sessionId: string, size: TerminalSize) => Promise<void>,   // { sessionId, cols, rows }
sessionClose: (sessionId: string) => Promise<void>,
```

`sessionChannels(callbacks)` (privée) : dans Tauri, `{ onEvent: new Channel<SessionEvent>(callbacks.onEvent),
onOutput: new Channel<ArrayBuffer>((buffer) => callbacks.onOutput(new Uint8Array(buffer))) }` ; avec le mock,
`{ onEvent: callbacks.onEvent, onOutput: callbacks.onOutput }`. ⚠ Un `Channel` **ne peut pas être construit hors de
Tauri** (son constructeur appelle `window.__TAURI_INTERNALS__`) : c'est pourquoi le mock reçoit les fonctions, et
pourquoi `Channel` n'est importé que dans `ipc.ts`.

### Le mock : `src/lib/mock/sessions.ts`

`sessionHandlers` (branché dans `HANDLERS`) et `resetMockSessions()` (appelée par `resetMockBackend`). Les sessions
vivantes sont dans une `Map` du module, remplacée à chaque changement (jamais dans `MockState`, qui doit rester
clonable). Les événements partent par `setTimeout`, espacés de `MOCK_STEP_MS` (80 ms ; 0 en mode test,
`import.meta.env.MODE === "test"`). La sortie est encodée en UTF-8 (`TextEncoder`).

- `ssh_open` : `cols`/`rows` hors bornes → `validation` ; id déjà ouvert → `validation` ; cible `saved` inconnue →
  `notFound` ; RDP → `validation` ; cible rapide dont l'hôte est vide ou contient une espace ou un `!` →
  `validation`. Ces refus rejettent la promesse, **sans** événement.
- Sinon la promesse se résout (`null`) et le scénario démarre :
  - connexion avec bastion (`jumpHostId`) : d'abord `hop` `started` / `done`, étiquette = nom du bastion (le mock
    anticipe T22 ; le vrai backend refuse encore les bastions) ;
  - cible rapide d'hôte `unreachable.test` : `target` `started`, `target` `failed`, puis
    `{ type: "error", error: { kind: "network", message: "connection refused by unreachable.test:<port>", detail: null } }` ;
  - sinon `target`, `hostKey`, `auth`, `open` (chacune `started` puis `done`, étiquettes comme en Rust), puis
    `connected`, puis la sortie `Welcome to <nom> — TunL mock shell\r\n` et l'invite `<user>@<host>:~$ `.
    Nom : celui de la connexion, ou `user@host` pour une cible rapide ; utilisateur : celui de la connexion ou de la
    cible, sinon `user`.
- `ssh_write` : session inconnue → `notFound`. Chaque caractère : imprimable → écho ; `\u007f` → efface le dernier
  caractère de la ligne (écho `\b \b`) ; `\u0003` → `^C\r\n` + invite ; `\r` → `\r\n`, puis la ligne s'exécute :
  `echo <texte>` → `<texte>\r\n` ; `stty size` → `<rows> <cols>\r\n` (la dernière taille reçue) ;
  `exit [n]` → `logout\r\n`, puis `{ type: "closed", reason: "remoteClosed", exitStatus: n ou 0 }` et la session est
  oubliée ; ligne vide → rien ; autre → `mock: <commande>: command not found\r\n`. Puis l'invite.
- `ssh_resize` : bornes → `validation`, inconnue → `notFound`, sinon retient la taille.
- `session_close` : oublie la session (ses minuteries annulées), **sans** événement ; inconnue → rien.

## Pièges

- `data_bytes` prend un `impl Into<Bytes>` : un `Vec<u8>` convient tel quel.
- `tokio::select!` : `read.wait()` et `input.recv()` sont annulables sans perte ; ne pas mettre d'`await` long
  dans une branche (le redimensionnement doit passer pendant un gros affichage).
- Le test IPC ouvre une vraie tâche (vers `127.0.0.1:1`, qui refuse) : `ssh_open` ne doit rien attendre d'elle.

## Tests du contrat

### `src-tauri/src/sessions_tests.rs`

```rust
use serde_json::json;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::error::{AppError, ErrorKind};
use crate::sessions::{
    CloseReason, SessionEvent, SessionHandle, SessionRegistry, ShellInput, StepKind, StepState,
};

fn handle() -> (SessionHandle, mpsc::UnboundedReceiver<ShellInput>) {
    let (input, receiver) = mpsc::unbounded_channel();
    let handle = SessionHandle {
        cancel: CancellationToken::new(),
        input,
    };
    (handle, receiver)
}

#[test]
fn input_reaches_the_session_task() {
    let registry = SessionRegistry::new();
    let id = Uuid::new_v4();
    let (session, mut receiver) = handle();
    registry.insert(id, session).unwrap();
    assert_eq!(registry.len(), 1);

    registry
        .send(id, ShellInput::Data(b"ls\n".to_vec()))
        .unwrap();
    registry
        .send(
            id,
            ShellInput::Resize {
                cols: 120,
                rows: 40,
            },
        )
        .unwrap();
    assert_eq!(
        receiver.try_recv().unwrap(),
        ShellInput::Data(b"ls\n".to_vec())
    );
    assert_eq!(
        receiver.try_recv().unwrap(),
        ShellInput::Resize {
            cols: 120,
            rows: 40
        }
    );
}

#[test]
fn a_session_id_is_used_once() {
    let registry = SessionRegistry::new();
    let id = Uuid::new_v4();
    registry.insert(id, handle().0).unwrap();
    let error = registry.insert(id, handle().0).unwrap_err();
    assert_eq!(error.kind, ErrorKind::Validation);
}

#[test]
fn an_unknown_or_finished_session_is_not_found() {
    let registry = SessionRegistry::new();
    let error = registry
        .send(Uuid::new_v4(), ShellInput::Data(vec![]))
        .unwrap_err();
    assert_eq!(error.kind, ErrorKind::NotFound);

    // The task ended and dropped its receiver: sending fails the same way.
    let id = Uuid::new_v4();
    let (session, receiver) = handle();
    registry.insert(id, session).unwrap();
    drop(receiver);
    assert_eq!(
        registry
            .send(id, ShellInput::Data(vec![]))
            .unwrap_err()
            .kind,
        ErrorKind::NotFound
    );
}

#[test]
fn closing_cancels_and_forgets_the_session() {
    let registry = SessionRegistry::new();
    let id = Uuid::new_v4();
    let (session, _receiver) = handle();
    let token = session.cancel.clone();
    registry.insert(id, session).unwrap();

    assert!(registry.close(id));
    assert!(token.is_cancelled());
    assert!(registry.is_empty());
    assert!(!registry.close(id), "closing twice is harmless");
}

#[test]
fn removing_does_not_cancel() {
    // The task removes its own entry when it ends; nothing left to cancel.
    let registry = SessionRegistry::new();
    let id = Uuid::new_v4();
    let (session, _receiver) = handle();
    let token = session.cancel.clone();
    registry.insert(id, session).unwrap();
    registry.remove(id);
    assert!(registry.is_empty());
    assert!(!token.is_cancelled());
}

#[test]
fn session_events_serialize_for_the_frontend() {
    let step = SessionEvent::Step {
        step: StepKind::HostKey,
        label: "db.internal".into(),
        state: StepState::Started,
    };
    assert_eq!(
        serde_json::to_value(step).unwrap(),
        json!({ "type": "step", "step": "hostKey", "label": "db.internal", "state": "started" })
    );
    assert_eq!(
        serde_json::to_value(SessionEvent::Connected).unwrap(),
        json!({ "type": "connected" })
    );
    assert_eq!(
        serde_json::to_value(SessionEvent::Closed {
            reason: CloseReason::RemoteClosed,
            exit_status: Some(0),
        })
        .unwrap(),
        json!({ "type": "closed", "reason": "remoteClosed", "exitStatus": 0 })
    );
    let error = SessionEvent::Error {
        error: AppError::new(ErrorKind::Auth, "authentication failed"),
    };
    assert_eq!(
        serde_json::to_value(error).unwrap(),
        json!({ "type": "error", "error": { "kind": "auth", "message": "authentication failed", "detail": null } })
    );
}
```

### `src-tauri/src/ssh/session_tests.rs` (déclaré dans `ssh/mod.rs` par `#[cfg(test)] mod session_tests;`)

```rust
use std::time::Duration;

use uuid::Uuid;

use super::auth::AuthPlan;
use super::session::{SessionTarget, resolve_target};
use crate::error::ErrorKind;
use crate::model::{
    Connection, ConnectionInput, Protocol, ProtocolSettings, SshAuth, SshDefaults, SshSettings,
};
use crate::store::Store;

fn connection(input: ConnectionInput) -> Connection {
    Connection::from_input(Uuid::new_v4(), input, 1_000)
}

fn ssh(name: &str, username: Option<&str>, settings: SshSettings) -> Connection {
    connection(ConnectionInput {
        name: name.into(),
        host: "10.0.0.12".into(),
        username: username.map(Into::into),
        settings: ProtocolSettings::Ssh(settings),
        ..ConnectionInput::template(Protocol::Ssh)
    })
}

fn defaults() -> SshDefaults {
    SshDefaults {
        connect_timeout_secs: 10,
        keepalive_secs: 30,
    }
}

fn store(connections: Vec<Connection>) -> Store {
    Store {
        groups: vec![],
        connections,
    }
}

#[test]
fn a_saved_connection_gives_its_address_user_and_plan() {
    let web = ssh(
        "web-01",
        Some("deploy"),
        SshSettings {
            auth: SshAuth::Key {
                path: "~/.ssh/id_ed25519".into(),
            },
            keepalive_secs: Some(5),
            connect_timeout_secs: None,
        },
    );
    let target = SessionTarget::Saved {
        connection_id: web.id,
    };
    let resolved =
        resolve_target(&target, &store(vec![web.clone()]), &defaults(), Some("ada")).unwrap();

    assert_eq!(resolved.connection_id, Some(web.id));
    assert_eq!(resolved.connection_name, "web-01");
    assert_eq!(resolved.host, "10.0.0.12");
    assert_eq!(resolved.port, 22);
    assert_eq!(resolved.username, "deploy");
    assert_eq!(
        resolved.plan,
        AuthPlan::Key {
            path: "~/.ssh/id_ed25519".into()
        }
    );
    // The connection's own values win over the global defaults.
    assert_eq!(resolved.keepalive_secs, 5);
    assert_eq!(resolved.connect_timeout, Duration::from_secs(10));
}

#[test]
fn without_a_username_the_local_user_is_used() {
    let web = ssh("web-01", None, SshSettings::default());
    let target = SessionTarget::Saved {
        connection_id: web.id,
    };
    let resolved = resolve_target(&target, &store(vec![web]), &defaults(), Some("ada")).unwrap();
    assert_eq!(resolved.username, "ada");
}

#[test]
fn an_unknown_connection_is_not_found() {
    let target = SessionTarget::Saved {
        connection_id: Uuid::new_v4(),
    };
    let error = resolve_target(&target, &store(vec![]), &defaults(), Some("ada")).unwrap_err();
    assert_eq!(error.kind, ErrorKind::NotFound);
}

#[test]
fn no_username_at_all_is_a_validation_error() {
    let web = ssh("web-01", None, SshSettings::default());
    let target = SessionTarget::Saved {
        connection_id: web.id,
    };
    let error = resolve_target(&target, &store(vec![web]), &defaults(), None).unwrap_err();
    assert_eq!(error.kind, ErrorKind::Validation);
    assert!(error.message.starts_with("username"), "{}", error.message);
}

#[test]
fn an_rdp_connection_cannot_open_a_shell() {
    let rdp = connection(ConnectionInput {
        name: "ad-01".into(),
        host: "10.0.0.5".into(),
        ..ConnectionInput::template(Protocol::Rdp)
    });
    let target = SessionTarget::Saved {
        connection_id: rdp.id,
    };
    let error = resolve_target(&target, &store(vec![rdp]), &defaults(), Some("ada")).unwrap_err();
    assert_eq!(error.kind, ErrorKind::Validation);
}

#[test]
fn a_jump_host_is_refused_until_t22() {
    let bastion = ssh("bastion", Some("ops"), SshSettings::default());
    let mut web = ssh("web-01", Some("deploy"), SshSettings::default());
    web.jump_host_id = Some(bastion.id);
    let target = SessionTarget::Saved {
        connection_id: web.id,
    };
    let error = resolve_target(
        &target,
        &store(vec![bastion, web]),
        &defaults(),
        Some("ada"),
    )
    .unwrap_err();
    assert_eq!(error.kind, ErrorKind::Validation);
    assert!(error.message.contains("jump"), "{}", error.message);
}

#[test]
fn a_quick_target_uses_the_defaults_and_the_auto_plan() {
    let target = SessionTarget::Quick {
        host: "10.5.5.5".into(),
        port: 2222,
        username: Some("deploy".into()),
    };
    let resolved = resolve_target(&target, &store(vec![]), &defaults(), Some("ada")).unwrap();
    assert_eq!(resolved.connection_id, None);
    assert_eq!(resolved.connection_name, "deploy@10.5.5.5");
    assert_eq!((resolved.host.as_str(), resolved.port), ("10.5.5.5", 2222));
    assert_eq!(resolved.plan, AuthPlan::Auto);
    assert_eq!(resolved.keepalive_secs, 30);
    assert_eq!(resolved.connect_timeout, Duration::from_secs(10));
}

#[test]
fn a_quick_target_is_validated_like_a_connection() {
    for (host, port) in [("", 22), ("bad host!", 22), ("10.5.5.5", 0)] {
        let target = SessionTarget::Quick {
            host: host.into(),
            port,
            username: None,
        };
        let error = resolve_target(&target, &store(vec![]), &defaults(), Some("ada")).unwrap_err();
        assert_eq!(error.kind, ErrorKind::Validation, "{host}:{port}");
    }
}
```

### `src-tauri/src/commands/ipc_ssh_tests.rs`

```rust
use serde_json::json;

use super::ipc_tests::{invoke, mock_app, ok};

const SESSION: &str = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

#[test]
fn ssh_commands_accept_the_arguments_sent_by_ipc_ts() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());
    // Port 1 of this machine refuses at once: the background task ends quickly, without touching the network.
    let templates = ok(&webview, "connection_templates", json!({}));
    let mut input = templates["ssh"].clone();
    input["name"] = json!("local");
    input["host"] = json!("127.0.0.1");
    input["port"] = json!(1);
    input["username"] = json!("deploy");
    let web = ok(&webview, "connection_create", json!({ "input": input }));

    // The session runs in the background: `ssh_open` answers at once, its steps go to the channels.
    let opened = ok(
        &webview,
        "ssh_open",
        json!({
            "sessionId": SESSION,
            "target": { "type": "saved", "connectionId": web["id"] },
            "cols": 80,
            "rows": 24,
            "onEvent": "__CHANNEL__:1",
            "onOutput": "__CHANNEL__:2"
        }),
    );
    assert_eq!(opened, json!(null));
    ok(&webview, "session_close", json!({ "sessionId": SESSION }));

    // Once closed, the session is gone: the arguments were read, the registry answered.
    let unknown = "0e1f2a3b-0000-4000-8000-000000000009";
    let error = invoke(
        &webview,
        "ssh_write",
        json!({ "sessionId": unknown, "data": "ls\r" }),
    )
    .unwrap_err();
    assert_eq!(error["kind"], "notFound");
    let error = invoke(
        &webview,
        "ssh_resize",
        json!({ "sessionId": unknown, "cols": 120, "rows": 40 }),
    )
    .unwrap_err();
    assert_eq!(error["kind"], "notFound");
    ok(&webview, "session_close", json!({ "sessionId": unknown }));
}

#[test]
fn bad_sizes_and_quick_targets_are_refused_before_anything_starts() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());

    let error = invoke(
        &webview,
        "ssh_resize",
        json!({ "sessionId": SESSION, "cols": 0, "rows": 24 }),
    )
    .unwrap_err();
    assert_eq!(error["kind"], "validation");

    let error = invoke(
        &webview,
        "ssh_open",
        json!({
            "sessionId": SESSION,
            "target": { "type": "quick", "host": "bad host!", "port": 22, "username": null },
            "cols": 80,
            "rows": 24,
            "onEvent": "__CHANNEL__:1",
            "onOutput": "__CHANNEL__:2"
        }),
    )
    .unwrap_err();
    assert_eq!(error["kind"], "validation");
}
```

### `src-tauri/tests/ssh_shell.rs` (contre podman : `npm run test:ssh`)

```rust
//! T19 against the podman target of T16: a whole shell session, from the first step to the exit status.
//! `npm run test:ssh`.
#![cfg(feature = "test-env")]

mod support;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use support::{TestEnv, context, respond};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use tunl_lib::error::ErrorKind;
use tunl_lib::prompts::PromptBroker;
use tunl_lib::secrets::{SecretKind, SecretStore, SecretValue};
use tunl_lib::sessions::{CloseReason, SessionEvent, SessionSink, ShellInput, StepKind, StepState};
use tunl_lib::ssh::SshContext;
use tunl_lib::ssh::auth::AuthPlan;
use tunl_lib::ssh::session::{ShellSession, SshTarget, run_ssh_session};
use uuid::Uuid;

/// Records every event and all the output, as the two Tauri channels would carry them.
#[derive(Default)]
struct Recorder {
    events: Mutex<Vec<SessionEvent>>,
    output: Mutex<Vec<u8>>,
}

impl SessionSink for Recorder {
    fn event(&self, event: SessionEvent) {
        self.events.lock().unwrap().push(event);
    }
    fn output(&self, bytes: Vec<u8>) {
        assert!(bytes.len() <= 64 * 1024, "output chunks are bounded (S10)");
        self.output.lock().unwrap().extend_from_slice(&bytes);
    }
}

impl Recorder {
    fn events(&self) -> Vec<SessionEvent> {
        self.events.lock().unwrap().clone()
    }
    fn text(&self) -> String {
        String::from_utf8_lossy(&self.output.lock().unwrap()).into_owned()
    }
    /// Waits (10 s at most) until `done` holds.
    async fn wait_for(&self, what: &str, done: impl Fn(&Recorder) -> bool) {
        for _ in 0..500 {
            if done(self) {
                return;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        panic!(
            "timed out waiting for {what}; events: {:?}; output: {:?}",
            self.events(),
            self.text()
        );
    }
}

fn target(env: &TestEnv, id: Uuid, port: u16) -> SshTarget {
    SshTarget {
        connection_id: Some(id),
        connection_name: "target".into(),
        host: env.host("target"),
        port,
        username: env.user(),
        plan: AuthPlan::Password,
        connect_timeout: Duration::from_secs(5),
        keepalive_secs: 15,
    }
}

/// A trusted context holding the password of connection `id`: no prompt at all.
async fn trusted(env: &TestEnv, dir: &std::path::Path, id: Uuid) -> SshContext {
    let broker = Arc::new(PromptBroker::new());
    respond(&broker, vec![]);
    let secrets = SecretStore::memory();
    secrets
        .set(
            id,
            "target",
            SecretKind::Password,
            &SecretValue::new(env.password()),
        )
        .await
        .unwrap();
    context(env, dir, broker, secrets)
}

struct Running {
    recorder: Arc<Recorder>,
    input: mpsc::UnboundedSender<ShellInput>,
    cancel: CancellationToken,
    task: tokio::task::JoinHandle<()>,
}

fn start(ctx: SshContext, target: SshTarget) -> Running {
    let recorder = Arc::new(Recorder::default());
    let (input, receiver) = mpsc::unbounded_channel();
    let cancel = CancellationToken::new();
    let session = ShellSession {
        id: Uuid::new_v4(),
        target,
        cols: 80,
        rows: 24,
        input: receiver,
        cancel: cancel.clone(),
    };
    let sink: Arc<dyn SessionSink> = recorder.clone();
    let task = tokio::spawn(run_ssh_session(ctx, session, sink));
    Running {
        recorder,
        input,
        cancel,
        task,
    }
}

fn step(step: StepKind, label: &str, state: StepState) -> SessionEvent {
    SessionEvent::Step {
        step,
        label: label.into(),
        state,
    }
}

fn is_connected(r: &Recorder) -> bool {
    r.events().contains(&SessionEvent::Connected)
}

#[tokio::test]
async fn a_shell_session_from_the_first_step_to_the_exit_status() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let id = Uuid::new_v4();
    let ctx = trusted(&env, dir.path(), id).await;
    let run = start(ctx, target(&env, id, env.port("target")));

    run.recorder.wait_for("Connected", is_connected).await;
    let address = format!("{}:{}", env.host("target"), env.port("target"));
    assert_eq!(
        run.recorder.events(),
        vec![
            step(StepKind::Target, &address, StepState::Started),
            step(StepKind::Target, &address, StepState::Done),
            step(StepKind::HostKey, &env.host("target"), StepState::Started),
            step(StepKind::HostKey, &env.host("target"), StepState::Done),
            step(StepKind::Auth, &env.user(), StepState::Started),
            step(StepKind::Auth, &env.user(), StepState::Done),
            step(StepKind::Open, "shell", StepState::Started),
            step(StepKind::Open, "shell", StepState::Done),
            SessionEvent::Connected,
        ]
    );

    run.input
        .send(ShellInput::Data(
            b"echo TERM=$TERM tunl-$((6*7))\n".to_vec(),
        ))
        .unwrap();
    run.recorder
        .wait_for("the echo", |r| r.text().contains("tunl-42"))
        .await;
    assert!(run.recorder.text().contains("TERM=xterm-256color"));

    run.input
        .send(ShellInput::Resize {
            cols: 132,
            rows: 40,
        })
        .unwrap();
    run.input
        .send(ShellInput::Data(b"stty size\n".to_vec()))
        .unwrap();
    run.recorder
        .wait_for("the new size", |r| r.text().contains("40 132"))
        .await;

    run.input
        .send(ShellInput::Data(b"exit 5\n".to_vec()))
        .unwrap();
    tokio::time::timeout(Duration::from_secs(10), run.task)
        .await
        .expect("the session ends with the shell")
        .unwrap();
    assert_eq!(
        run.recorder.events().last(),
        Some(&SessionEvent::Closed {
            reason: CloseReason::RemoteClosed,
            exit_status: Some(5),
        })
    );
}

#[tokio::test]
async fn cancelling_closes_the_session_as_user_closed() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let id = Uuid::new_v4();
    let ctx = trusted(&env, dir.path(), id).await;
    let run = start(ctx, target(&env, id, env.port("target")));

    run.recorder.wait_for("Connected", is_connected).await;
    run.cancel.cancel();
    tokio::time::timeout(Duration::from_secs(5), run.task)
        .await
        .expect("cancel ends the task")
        .unwrap();
    assert_eq!(
        run.recorder.events().last(),
        Some(&SessionEvent::Closed {
            reason: CloseReason::UserClosed,
            exit_status: None,
        })
    );
}

#[tokio::test]
async fn a_failed_step_is_reported_then_the_error() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let id = Uuid::new_v4();
    let ctx = trusted(&env, dir.path(), id).await;
    // Nothing listens on port 1.
    let run = start(ctx, target(&env, id, 1));

    tokio::time::timeout(Duration::from_secs(10), run.task)
        .await
        .expect("a refused connection ends the task")
        .unwrap();
    let events = run.recorder.events();
    let address = format!("{}:1", env.host("target"));
    assert_eq!(
        events[..2],
        [
            step(StepKind::Target, &address, StepState::Started),
            step(StepKind::Target, &address, StepState::Failed),
        ]
    );
    assert!(
        matches!(&events[2], SessionEvent::Error { error } if error.kind == ErrorKind::Network),
        "{events:?}"
    );
    assert_eq!(
        events.len(),
        3,
        "no Connected, no Closed after an error: {events:?}"
    );
}

#[tokio::test]
async fn cancelling_while_connecting_ends_quietly() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let id = Uuid::new_v4();
    // No stored password and a prompt nobody answers: the session waits at the Auth step.
    let broker = Arc::new(PromptBroker::new());
    broker.set_emitter(Box::new(|_| {}));
    let ctx = context(&env, dir.path(), broker.clone(), SecretStore::memory());
    let run = start(ctx, target(&env, id, env.port("target")));

    run.recorder
        .wait_for("the Auth step", |r| {
            r.events()
                .contains(&step(StepKind::Auth, &env.user(), StepState::Started))
        })
        .await;
    run.cancel.cancel();
    tokio::time::timeout(Duration::from_secs(5), run.task)
        .await
        .expect("cancel interrupts a pending step")
        .unwrap();
    assert_eq!(
        run.recorder.events().last(),
        Some(&SessionEvent::Closed {
            reason: CloseReason::UserClosed,
            exit_status: None,
        })
    );
    // The abandoned prompt does not linger in the broker.
    assert_eq!(broker.pending_count(), 0);
}
```

### `src/lib/mock/sessions.test.ts`

```ts
// The browser mock of the SSH sessions (T19): the steps, a tiny shell, the refusals. The UI of T20–T21 is
// developed and tested against it, so its behaviour is a contract too.
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { SessionEvent } from "@/bindings/SessionEvent";
import type { SessionTarget } from "@/bindings/SessionTarget";
import { toAppError } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import { resetMockBackend } from "@/lib/ipc-mock";
import { MOCK_IDS } from "@/lib/mock/data";

const SIZE = { cols: 80, rows: 24 };

function recorder() {
  const events: SessionEvent[] = [];
  const decoder = new TextDecoder();
  let output = "";
  return {
    events,
    text: () => output,
    callbacks: {
      onEvent: (event: SessionEvent) => {
        events.push(event);
      },
      onOutput: (bytes: Uint8Array) => {
        output += decoder.decode(bytes);
      },
    },
  };
}

type Recorder = ReturnType<typeof recorder>;

const nas: SessionTarget = { type: "saved", connectionId: MOCK_IDS.nas };

async function openConnected(id: string, target: SessionTarget = nas): Promise<Recorder> {
  const r = recorder();
  await ipc.sshOpen(id, target, SIZE, r.callbacks);
  await vi.waitFor(() => expect(r.events).toContainEqual({ type: "connected" }));
  return r;
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return toAppError(error);
  }
  throw new Error("expected a rejection");
}

beforeEach(() => {
  resetMockBackend();
});

describe("mock SSH sessions", () => {
  test("a direct connection goes through the four steps, then prints a banner and a prompt", async () => {
    const r = await openConnected("s1");
    const steps = r.events.flatMap((e) => (e.type === "step" ? [`${e.step}:${e.state}`] : []));
    expect(steps).toEqual([
      "target:started",
      "target:done",
      "hostKey:started",
      "hostKey:done",
      "auth:started",
      "auth:done",
      "open:started",
      "open:done",
    ]);
    expect(r.events.at(-1)).toEqual({ type: "connected" });
    await vi.waitFor(() => expect(r.text()).toContain("Welcome to nas"));
    expect(r.text()).toContain("admin@192.168.1.10:~$ ");
  });

  test("a connection behind a bastion goes through a Hop step first", async () => {
    const r = await openConnected("s1", { type: "saved", connectionId: MOCK_IDS.web01 });
    expect(r.events.slice(0, 3)).toEqual([
      { type: "step", step: "hop", label: "bastion-01", state: "started" },
      { type: "step", step: "hop", label: "bastion-01", state: "done" },
      { type: "step", step: "target", label: "10.0.0.12:22", state: "started" },
    ]);
    await vi.waitFor(() => expect(r.text()).toContain("deploy@10.0.0.12:~$ "));
  });

  test("typed characters are echoed and a line runs on Enter", async () => {
    const r = await openConnected("s1");
    await ipc.sshWrite("s1", "echo hello\r");
    await vi.waitFor(() => expect(r.text()).toContain("echo hello\r\nhello\r\n"));

    await ipc.sshWrite("s1", "whoami\r");
    await vi.waitFor(() => expect(r.text()).toContain("mock: whoami: command not found\r\n"));
  });

  test("backspace erases the last typed character", async () => {
    const r = await openConnected("s1");
    await ipc.sshWrite("s1", "echo x\u007fy\r");
    await vi.waitFor(() => expect(r.text()).toContain("\b \b"));
    await vi.waitFor(() => expect(r.text()).toContain("y\r\n"));
    expect(r.text()).not.toContain("xy\r\n");
  });

  test("stty size tells the last size the terminal sent", async () => {
    const r = await openConnected("s1");
    await ipc.sshResize("s1", { cols: 132, rows: 40 });
    await ipc.sshWrite("s1", "stty size\r");
    await vi.waitFor(() => expect(r.text()).toContain("40 132\r\n"));
  });

  test("exit closes the session with its status, and the session is gone", async () => {
    const r = await openConnected("s1");
    await ipc.sshWrite("s1", "exit 3\r");
    await vi.waitFor(() =>
      expect(r.events.at(-1)).toEqual({ type: "closed", reason: "remoteClosed", exitStatus: 3 }),
    );
    expect((await rejection(ipc.sshWrite("s1", "ls\r"))).kind).toBe("notFound");
  });

  test("a quick target connects with the typed user, or the local one", async () => {
    const quick = await openConnected("q1", {
      type: "quick",
      host: "10.5.5.5",
      port: 2222,
      username: "ops",
    });
    await vi.waitFor(() => expect(quick.text()).toContain("ops@10.5.5.5:~$ "));
    await vi.waitFor(() => expect(quick.text()).toContain("Welcome to ops@10.5.5.5"));

    const local = await openConnected("q2", {
      type: "quick",
      host: "10.5.5.6",
      port: 22,
      username: null,
    });
    await vi.waitFor(() => expect(local.text()).toContain("user@10.5.5.6:~$ "));
  });

  test("an unreachable quick target fails at the Target step", async () => {
    const r = recorder();
    await ipc.sshOpen(
      "s1",
      { type: "quick", host: "unreachable.test", port: 22, username: null },
      SIZE,
      r.callbacks,
    );
    await vi.waitFor(() => expect(r.events.at(-1)?.type).toBe("error"));
    expect(r.events.slice(0, 2)).toEqual([
      { type: "step", step: "target", label: "unreachable.test:22", state: "started" },
      { type: "step", step: "target", label: "unreachable.test:22", state: "failed" },
    ]);
    const last = r.events.at(-1);
    expect(last?.type === "error" && last.error.kind).toBe("network");
    expect(r.events).not.toContainEqual({ type: "connected" });
  });

  test("unknown, RDP and invalid targets are refused at once", async () => {
    const unknown = {
      type: "saved",
      connectionId: "00000000-0000-4000-8000-000000000000",
    } as const;
    expect((await rejection(ipc.sshOpen("a", unknown, SIZE, recorder().callbacks))).kind).toBe(
      "notFound",
    );
    const rdp = { type: "saved", connectionId: MOCK_IDS.ad01 } as const;
    expect((await rejection(ipc.sshOpen("b", rdp, SIZE, recorder().callbacks))).kind).toBe(
      "validation",
    );
    const bad = { type: "quick", host: "bad host!", port: 22, username: null } as const;
    expect((await rejection(ipc.sshOpen("c", bad, SIZE, recorder().callbacks))).kind).toBe(
      "validation",
    );
  });

  test("a session id is used once", async () => {
    await openConnected("s1");
    const error = await rejection(ipc.sshOpen("s1", nas, SIZE, recorder().callbacks));
    expect(error.kind).toBe("validation");
  });

  test("closing stops the session; closing twice is harmless", async () => {
    const r = await openConnected("s1");
    await ipc.sessionClose("s1");
    expect((await rejection(ipc.sshWrite("s1", "ls\r"))).kind).toBe("notFound");
    await ipc.sessionClose("s1");
    // The UI closed it: no Closed event is sent back.
    expect(r.events.some((e) => e.type === "closed")).toBe(false);
  });

  test("resetting the mock drops every session", async () => {
    await openConnected("s1");
    resetMockBackend();
    expect((await rejection(ipc.sshWrite("s1", "ls\r"))).kind).toBe("notFound");
  });
});
```


## Étapes

1. Les tests : `node scripts/contract-tests.mjs T19`.
2. `Cargo.toml`, `sessions.rs`, puis `cargo test sessions`.
3. `ssh/session.rs` : `resolve_target`, `default_username`, puis `cargo test ssh::session`.
4. `ssh/shell.rs`, `run_ssh_session`, `AppState`, `commands/ssh.rs`, `npm run bindings`, `npm run verify:rust`,
   puis `npm run test:ssh`.
5. `ipc.ts`, `lib/mock/sessions.ts`, puis `npx vitest run src/lib`.
6. `npm run format`, `npm run review`, cases, statut, commit `feat: SSH shell sessions with PTY, byte channel and registry (T19)`.

## Critères d'acceptation

- [x] `npm run review` passe, et `node scripts/contract-tests.mjs T19 --check` affiche `OK` partout.
- [x] `grep -rn "new Channel" src` ne trouve que `src/lib/ipc.ts`.
- [x] Aucun log ne contient d'octets du terminal : `grep -rn "log::" src-tauri/src/ssh/shell.rs` ne cite jamais `data`.

## À regarder par Florian

Rien à l'écran (T20 dessine le terminal, T21 les onglets). `npm run test:ssh` : une vraie session de bout en bout
(`echo`, `stty size` après redimensionnement, `exit 5`).
