# T17 — Noyau SSH : TCP, poignée de main, `known_hosts`, `PromptBroker`

| | |
|---|---|
| **Jalon** | M2 — SSH |
| **Dépend de** | T12, T16 |
| **Lire avant** | `docs/01-architecture.md` §5 et §7, `docs/06-securite.md` §2 (S6, S7, S8, S9), `docs/02-decisions.md` D03 et D10 |
| **Livrable** | Modules `prompts.rs` et `ssh/` (`mod`, `error`, `known_hosts`, `handler`, `connect`), commandes `prompt_answer` et `known_host_remove`, feature Cargo `test-env`, scripts `test:ssh` ; 26 tests Rust, 1 test IPC, 7 tests d'intégration contre podman |

## Pourquoi

C'est la première brique du client SSH de TunL (russh, sans le binaire `ssh`). Elle ouvre le TCP, négocie la session
SSH et **décide de faire confiance ou non à la clé du serveur** (S6) : clé connue → on continue ; clé inconnue → on
demande à l'utilisateur, via le `PromptBroker` ; clé différente de celle connue → refus net, sans « continuer quand
même ». L'authentification (T18) et le shell (T19) viendront se brancher sur la poignée de main livrée ici.

Tout ce qui touche russh a été **prototypé par l'orchestrateur** contre les conteneurs de T16 (russh 0.63.3) :
les appels et les pièges ci-dessous sont vérifiés. Tu n'as rien à explorer dans la crate.

## À réutiliser (ne pas réécrire)

- `AppError::new`, `AppError::validation`, `AppError::not_found`, `AppError::internal`, `with_detail`, `ErrorDetail`
  (`error.rs`) ; `SecretStore`, `SecretValue` (`secrets.rs`, T12) ; `AppPaths` (`paths.rs`).
- Le patron des tests IPC : `mock_app`, `invoke`, `ok` de `commands/ipc_tests.rs`.
- L'environnement podman de T16 : `npm run test-env:up`, `scripts/test-env/.state/env.json`.

## Contrat — Rust

### Dépendances et feature (`src-tauri/Cargo.toml`)

```toml
[features]
# Integration tests against the podman servers of T16 (`npm run test:ssh`).
test-env = []

[dependencies]
russh = "0.63"          # features par défaut (aws-lc-rs) ; les clés sont dans russh::keys, pas de crate russh-keys
```

### Scripts npm (`package.json`)

```json
"test:ssh": "npm run test-env:up && cd src-tauri && cargo test --features test-env --test 'ssh_*'",
"verify:rust": "cd src-tauri && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings && cargo test",
"review": "npm run verify && npm run test:ssh && npm run e2e"
```

`--all-features` fait passer clippy sur les tests d'intégration, qui ne compilent qu'avec `test-env`. Sans cette
feature, `cargo test` les ignore : `verify` ne dépend donc pas de podman, `review` si.

### `ErrorDetail::HostKeyChanged` (`error.rs`) : deux champs de plus

```rust
HostKeyChanged {
    host: String, port: u16, key_type: String,
    fingerprint: String,          // the key the server presents now
    known_fingerprint: String,    // NEW: the key recorded in known_hosts
    known_hosts_path: String, line: u32,
    removable: bool,              // NEW: true when the record is in TunL's own file (known_host_remove can drop it)
},
```

Ajoute ces deux champs au littéral du test `serializes_details_with_camel_case_fields` du même fichier
(`known_fingerprint: "SHA256:old".into()`, `removable: true`) : ce test du lot 1 n'est pas un test du contrat.

### `src-tauri/src/prompts.rs` (déclaré `pub mod prompts;`)

```rust
pub const PROMPT_EVENT: &str = "tunl://prompt";
pub const PROMPT_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)] #[serde(rename_all = "camelCase")] #[ts(export)]
pub struct PromptRequest { pub id: Uuid, pub session_id: Option<Uuid>, pub prompt: PromptKind }

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")] #[ts(export)]
pub enum PromptKind {
    HostKeyUnknown { host: String, port: u16, key_type: String, fingerprint: String },
    Password { connection_name: String, username: String, host: String, can_save: bool, retry: bool },
    Passphrase { connection_name: String, key_path: String, can_save: bool, retry: bool },
    KeyboardInteractive { connection_name: String, name: String, instructions: String, prompts: Vec<InteractivePrompt> },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)] #[serde(rename_all = "camelCase")] #[ts(export)]
pub struct InteractivePrompt { pub text: String, pub echo: bool }

/// The UI's answer. `Debug` is safe: `SecretValue` prints `***` (S3).
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")] #[ts(export)]
pub enum PromptAnswer {
    Accept,
    Reject,
    Secret { #[ts(type = "string")] value: SecretValue, save: bool },
    Responses { #[ts(type = "Array<string>")] values: Vec<SecretValue> },
    Cancel,
}

pub type PromptEmitter = Box<dyn Fn(&PromptRequest) + Send + Sync>;

pub struct PromptBroker { /* pending: std::sync::Mutex<HashMap<Uuid, Pending>>, emitter: OnceLock<PromptEmitter>, timeout */ }
impl PromptBroker {
    pub fn new() -> Self;                                   // timeout = PROMPT_TIMEOUT ; + impl Default
    pub fn with_timeout(timeout: Duration) -> Self;         // tests
    pub fn set_emitter(&self, emitter: PromptEmitter);      // once (a second call: log::warn!, ignored)
    pub async fn ask(&self, session_id: Option<Uuid>, prompt: PromptKind) -> AppResult<PromptAnswer>;
    pub fn answer(&self, id: Uuid, answer: PromptAnswer) -> AppResult<()>;
    pub fn cancel_session(&self, session_id: Uuid);
    pub fn pending_count(&self) -> usize;
}
```

`ask` :
1. Pas d'émetteur → `AppError::internal("no prompt emitter")`, rien d'enregistré.
2. `id = Uuid::new_v4()`, un `tokio::sync::oneshot`, l'attente enregistrée sous `id` (avec son `session_id`).
3. **Le verrou est relâché avant d'appeler l'émetteur** : un émetteur peut répondre immédiatement (les tests le font).
4. `tokio::time::timeout(self.timeout, receiver)` : réponse → `Ok(answer)` ; émetteur détruit (`cancel_session`) →
   `ErrorKind::Cancelled`, `"prompt cancelled"` ; délai dépassé → `ErrorKind::Cancelled`, `"prompt timed out"`.
5. Quoi qu'il arrive, l'entrée ne survit pas à `ask`, **même si le futur est abandonné** (onglet fermé pendant la
   question) : un petit garde dont le `Drop` retire `id` de la table.

`answer` : retire l'entrée ; inconnue → `AppError::not_found(format!("prompt {id}"))`. `cancel_session` : retire (et
donc détruit) toutes les attentes de cette session. Jamais de verrou `std::sync::Mutex` tenu à travers un `.await`.

### `src-tauri/src/ssh/mod.rs` (déclaré `pub mod ssh;`)

```rust
pub mod connect; pub mod error; pub mod handler; pub mod known_hosts;
#[cfg(test)] mod error_tests;
#[cfg(test)] mod known_hosts_tests;

/// Everything a connection needs besides its target. Cheap to clone.
#[derive(Clone)]
pub struct SshContext {
    pub known_hosts: Arc<KnownHosts>,
    pub prompts: Arc<PromptBroker>,
    pub secrets: Arc<SecretStore>,          // used from T18
    pub agent_socket: Option<PathBuf>,      // SSH_AUTH_SOCK, used from T18
}
```

### `src-tauri/src/ssh/known_hosts.rs`

```rust
pub const KNOWN_HOSTS_FILE: &str = "known_hosts";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostKeyStatus { Known, Unknown, Changed { path: PathBuf, line: usize, known_fingerprint: String, removable: bool } }

#[derive(Debug, Clone)]
pub struct KnownHosts { pub own: PathBuf, pub user: Option<PathBuf> }
impl KnownHosts {
    pub fn new(own: PathBuf, user: Option<PathBuf>) -> Self;
    pub fn for_app(config_dir: &Path) -> Self;     // own = config_dir/known_hosts ; user = ~/.ssh/known_hosts (if a home exists)
    pub fn check(&self, host: &str, port: u16, key: &PublicKey) -> HostKeyStatus;
    pub fn learn(&self, host: &str, port: u16, key: &PublicKey) -> AppResult<()>;
    pub fn remove(&self, host: &str, port: u16) -> AppResult<usize>;
}
pub fn host_pattern(host: &str, port: u16) -> String;   // "db.internal" (port 22), "[127.0.0.1]:2222"
pub fn fingerprint(key: &PublicKey) -> String;          // key.fingerprint(HashAlg::Sha256).to_string() → "SHA256:…"
```

- `check` lit le fichier de TunL (`removable: true`) **puis** celui de l'utilisateur (`removable: false`), chacun par
  `russh::keys::known_hosts::known_host_keys_path(host, port, path)` (fichier absent → liste vide ; il gère les
  entrées hachées `|1|…`). Une erreur de lecture (clé illisible sur une ligne qui correspond) → `log::warn!` et ce
  fichier compte pour vide. Puis : une entrée **égale** à `key`, dans l'un ou l'autre → `Known` ; sinon la première
  entrée de **même algorithme** → `Changed` (son chemin, sa ligne, son empreinte) ; sinon `Unknown` (une clé d'un
  autre type, par exemple ECDSA quand le serveur présente ed25519, ne compte pas comme un changement).
- `learn` écrit **lui-même** la ligne `<host_pattern> <algorithme> <base64>` à la fin du fichier de TunL :
  `key.to_openssh()` donne `algo base64 [commentaire]`, garder les deux premiers champs. Ouverture
  `OpenOptions::new().create(true).append(true).mode(0o600)` (`std::os::unix::fs::OpenOptionsExt`), puis
  `set_permissions(0o600)` au cas où le fichier existait avec d'autres droits (S9). Si le fichier ne finit pas par
  `\n`, en ajouter un d'abord. Jamais de ligne de commentaire. Erreur → `ErrorKind::Io`, `"cannot write <chemin>"`.
- `remove` ne touche **que** le fichier de TunL (D10) : enlève chaque ligne dont un des hôtes (premier champ, séparé
  par des virgules) vaut `host_pattern(host, port)`, réécrit le fichier en `0600` s'il a changé, renvoie le nombre de
  lignes retirées. Fichier absent → `Ok(0)`, sans le créer.

### `src-tauri/src/ssh/error.rs`

```rust
#[derive(Debug)]
pub enum SshError { Russh(russh::Error), App(AppError) }     // the Handler's error type
impl From<russh::Error> for SshError;  impl From<AppError> for SshError;
impl From<SshError> for AppError;       // App(e) → e unchanged ; Russh(e) → map_russh_error(&e)
pub fn map_russh_error(error: &russh::Error) -> AppError;
```

| Erreur russh | `ErrorKind` | Message (anglais, **jamais** le texte d'origine : S7) |
|---|---|---|
| `UnknownKey`, `WrongServerSig` | `HostKeyRejected` | `host key rejected` |
| `KeyChanged { .. }` | `HostKeyChanged` | `host key changed` |
| `ConnectionTimeout`, `KeepaliveTimeout`, `InactivityTimeout`, `Elapsed(_)` | `Timeout` | `the server stopped answering` |
| `NoAuthMethod`, `NotAuthenticated`, `UnsupportedAuthMethod` | `Auth` | `authentication failed` |
| `ChannelOpenFailure(_)` | `Network` | `the server refused to open a channel` |
| `Disconnect`, `HUP`, `IO(_)`, `SendError`, `RecvError` | `Network` | `connection closed` |
| tout le reste (`KexInit`, `NoCommonAlgo`…) | `Network` | `ssh protocol error` |

Le détail d'origine peut aller dans un `log::debug!` (pas de secret à craindre : ce sont des erreurs de protocole).

### `src-tauri/src/ssh/handler.rs`

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostKeyTarget { pub host: String, pub port: u16, pub session_id: Option<Uuid> }

pub struct ClientHandler { /* target, ctx: SshContext */ }
impl ClientHandler { pub fn new(target: HostKeyTarget, ctx: SshContext) -> Self; }
impl russh::client::Handler for ClientHandler { type Error = SshError; async fn check_server_key(…) }
```

`check_server_key(&mut self, key: &russh::keys::PublicKeyOrCertificate)` (le trait accepte un `async fn`) :
- `PublicKeyOrCertificate::Certificate(_)` → `Err(App(HostKeyRejected, "host certificates are not supported"))`.
- `PublicKey { key, .. }` → `known_hosts.check(host, port, key)` :
  - `Known` → `Ok(true)` ;
  - `Changed { … }` → `Err(App(…))` : `ErrorKind::HostKeyChanged`, `"host key changed"`, avec
    `ErrorDetail::HostKeyChanged` rempli (`key_type = key.algorithm().as_str()`, `fingerprint` = celle présentée,
    `known_hosts_path` = `path.to_string_lossy()`, `line as u32`). **Aucun prompt** (S6) ;
  - `Unknown` → `prompts.ask(session_id, HostKeyUnknown { host, port, key_type, fingerprint })` :
    `Accept` → `known_hosts.learn(…)` (un échec d'écriture : `log::warn!`, on continue quand même pour cette
    session) puis `Ok(true)` ; `Reject`, `Cancel` ou toute autre réponse → `ErrorKind::HostKeyRejected`,
    `"host key rejected"` ; `ask` en erreur (délai, onglet fermé) → cette erreur telle quelle (`Cancelled`).

Attendre la réponse dans `check_server_key` est **sans risque** : le prototype a répondu au bout de 2 s, la
négociation a attendu.

### `src-tauri/src/ssh/connect.rs`

```rust
pub fn client_config(keepalive_secs: u32) -> Arc<russh::client::Config>;
pub async fn tcp_connect(host: &str, port: u16, timeout: Duration) -> AppResult<tokio::net::TcpStream>;
pub async fn handshake<S>(stream: S, target: HostKeyTarget, config: Arc<russh::client::Config>, ctx: &SshContext)
    -> AppResult<russh::client::Handle<ClientHandler>>
where S: AsyncRead + AsyncWrite + Unpin + Send + 'static;
```

- `client_config` : `Config { inactivity_timeout: None, keepalive_interval: (keepalive_secs > 0).then(…secs…),
  keepalive_max: 3, ..Default::default() }`.
- `tcp_connect` : `tokio::time::timeout(timeout, TcpStream::connect((host, port)))`, puis `set_nodelay(true)`.
  Délai → `Timeout`, `"no answer from <host>:<port> within <n> s"` ; refus → `Network`,
  `"connection refused by <host>:<port>"` ; autre erreur → `Network`, `"cannot reach <host>:<port>"`.
  ⚠ Le délai couvre **le TCP seulement**, jamais la poignée de main (l'utilisateur peut lire l'empreinte longtemps).
- `handshake` : `russh::client::connect_stream(config, stream, ClientHandler::new(target, ctx.clone()))`, erreur
  convertie par `From<SshError> for AppError`. Un `stream` générique : T22 y passera un canal `direct-tcpip`.

### `AppState` et `lib.rs`

- Nouveaux champs : `pub secrets: Arc<SecretStore>` (était `SecretStore` : les appels `state.secrets.set(…)` ne
  changent pas), `pub prompts: Arc<PromptBroker>`, `pub known_hosts: Arc<KnownHosts>` (`KnownHosts::for_app`).
  `from_disk(paths, now_ms, secrets)` garde sa signature et construit ces champs.
- `pub fn blocked(paths: &AppPaths, now_ms: i64, error: AppError, secrets: SecretStore) -> Self` : l'état de repli
  que `lib.rs` construisait à la main (store bloqué, réglages par défaut). Les champs futurs ne toucheront plus `lib.rs`.
- `pub fn ssh_context(&self) -> SshContext` : les trois `Arc` clonés, `agent_socket = std::env::var_os("SSH_AUTH_SOCK")`.
- `setup` : après `app.manage(state)`, l'émetteur du broker envoie l'événement global :
  `handle.emit(PROMPT_EVENT, request)` (`use tauri::Emitter;`), échec → `log::warn!`. Garder un clone de
  `state.prompts` **avant** `manage`.

### Commandes : `src-tauri/src/commands/prompts.rs`

| Commande | Arguments (JS) | Retour | Règles |
|---|---|---|---|
| `prompt_answer` | `{ id, answer }` | `()` | `state.prompts.answer(id, answer)` |
| `known_host_remove` | `{ host, port }` | `u32` (lignes retirées) | hôte vide → `validation("host", …)` ; port 0 → `validation("port", …)` ; `log::info!` du motif retiré |

Ajoutées à `invoke_handler()`, avec `#[cfg(test)] mod ipc_prompts_tests;` dans `commands/mod.rs`.

## Contrat — TypeScript

- `npm run bindings` : `PromptRequest`, `PromptKind`, `InteractivePrompt`, `PromptAnswer`, `ErrorDetail` (mis à jour).
- `ipc.ts` : `promptAnswer(id: string, answer: PromptAnswer)` → `void` ; `knownHostRemove(host: string, port: number)`
  → `number`.
- Mock : `src/lib/mock/prompts.ts`, `promptHandlers` branché dans `HANDLERS`. Pour l'instant aucun prompt n'est
  jamais posé : `prompt_answer` → rejet `notFound` (`"prompt <id>"`) ; `known_host_remove` → `0`. T21b l'enrichira.

## Pièges (vus au prototype)

- `known_host_keys_path` numérote les lignes **sans compter les commentaires** : la ligne est juste dans le fichier
  de TunL (jamais de commentaire), approximative dans celui de l'utilisateur. Elle n'est qu'affichée.
- `learn_known_hosts_path` de russh écrit une **ligne vide** en tête d'un fichier neuf : c'est pourquoi `learn`
  écrit sa ligne lui-même.
- Le trait `Handler` refuse toute clé par défaut (`Ok(false)` → russh renvoie `UnknownKey`) : toujours passer par
  `known_hosts.check`.
- Les tests `tokio::spawn`ent `broker.ask` : le futur doit être `Send`, donc aucun `MutexGuard` vivant à un `.await`.

## Tests du contrat

### `src-tauri/src/prompts_tests.rs` (déclaré dans `lib.rs` par `#[cfg(test)] mod prompts_tests;`)

```rust
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::json;
use uuid::Uuid;

use crate::error::ErrorKind;
use crate::prompts::{InteractivePrompt, PromptAnswer, PromptBroker, PromptKind, PromptRequest};

type Seen = Arc<Mutex<Vec<PromptRequest>>>;

fn host_key() -> PromptKind {
    PromptKind::HostKeyUnknown {
        host: "db.internal".into(),
        port: 22,
        key_type: "ssh-ed25519".into(),
        fingerprint: "SHA256:abc".into(),
    }
}

/// A broker whose emitter records every request it is asked to show.
fn recording(timeout: Duration) -> (Arc<PromptBroker>, Seen) {
    let broker = Arc::new(PromptBroker::with_timeout(timeout));
    let seen: Seen = Arc::new(Mutex::new(Vec::new()));
    let sink = seen.clone();
    broker.set_emitter(Box::new(move |request| {
        sink.lock().unwrap().push(request.clone())
    }));
    (broker, seen)
}

/// Waits for the `n`-th emitted request (1-based).
async fn nth_request(seen: &Seen, n: usize) -> PromptRequest {
    for _ in 0..400 {
        if let Some(request) = seen.lock().unwrap().get(n - 1).cloned() {
            return request;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    panic!("prompt #{n} was never emitted");
}

#[tokio::test]
async fn an_answer_reaches_the_asking_task() {
    let (broker, seen) = recording(Duration::from_secs(5));
    let session = Uuid::new_v4();
    let asking = tokio::spawn({
        let broker = broker.clone();
        async move { broker.ask(Some(session), host_key()).await }
    });

    let request = nth_request(&seen, 1).await;
    assert_eq!(request.session_id, Some(session));
    assert_eq!(request.prompt, host_key());
    assert_eq!(broker.pending_count(), 1);

    broker.answer(request.id, PromptAnswer::Accept).unwrap();
    assert!(matches!(asking.await.unwrap(), Ok(PromptAnswer::Accept)));
    assert_eq!(broker.pending_count(), 0);
}

#[tokio::test]
async fn an_emitter_may_answer_at_once() {
    // `ask` releases its lock before calling the emitter: answering from inside it must not deadlock.
    let broker = Arc::new(PromptBroker::with_timeout(Duration::from_secs(5)));
    let weak = Arc::downgrade(&broker);
    broker.set_emitter(Box::new(move |request| {
        if let Some(broker) = weak.upgrade() {
            broker.answer(request.id, PromptAnswer::Reject).unwrap();
        }
    }));
    let answer = tokio::time::timeout(Duration::from_secs(2), broker.ask(None, host_key()))
        .await
        .expect("ask deadlocked");
    assert!(matches!(answer, Ok(PromptAnswer::Reject)));
}

#[tokio::test]
async fn answering_an_unknown_prompt_is_not_found() {
    let (broker, _) = recording(Duration::from_secs(5));
    let error = broker
        .answer(Uuid::new_v4(), PromptAnswer::Cancel)
        .unwrap_err();
    assert_eq!(error.kind, ErrorKind::NotFound);
}

#[tokio::test]
async fn a_prompt_left_unanswered_times_out_as_cancelled() {
    let (broker, _) = recording(Duration::from_millis(50));
    let error = broker.ask(None, host_key()).await.unwrap_err();
    assert_eq!(error.kind, ErrorKind::Cancelled);
    assert_eq!(broker.pending_count(), 0);
}

#[tokio::test]
async fn closing_a_session_cancels_its_prompts_only() {
    let (broker, seen) = recording(Duration::from_secs(5));
    let closed = Uuid::new_v4();
    let other = Uuid::new_v4();
    let first = tokio::spawn({
        let broker = broker.clone();
        async move { broker.ask(Some(closed), host_key()).await }
    });
    nth_request(&seen, 1).await;
    let second = tokio::spawn({
        let broker = broker.clone();
        async move { broker.ask(Some(other), host_key()).await }
    });
    let request = nth_request(&seen, 2).await;

    broker.cancel_session(closed);
    assert_eq!(first.await.unwrap().unwrap_err().kind, ErrorKind::Cancelled);
    assert_eq!(broker.pending_count(), 1);

    broker.answer(request.id, PromptAnswer::Reject).unwrap();
    assert!(matches!(second.await.unwrap(), Ok(PromptAnswer::Reject)));
}

#[tokio::test]
async fn a_dropped_ask_leaves_nothing_pending() {
    // A session cancelled while its prompt is open drops the `ask` future: its entry goes with it.
    let (broker, seen) = recording(Duration::from_secs(5));
    let asking = tokio::spawn({
        let broker = broker.clone();
        async move { broker.ask(None, host_key()).await }
    });
    nth_request(&seen, 1).await;
    asking.abort();
    let _ = asking.await;
    assert_eq!(broker.pending_count(), 0);
}

#[tokio::test]
async fn asking_without_an_emitter_is_an_internal_error() {
    let broker = PromptBroker::with_timeout(Duration::from_secs(5));
    let error = broker.ask(None, host_key()).await.unwrap_err();
    assert_eq!(error.kind, ErrorKind::Internal);
    assert_eq!(broker.pending_count(), 0);
}

#[test]
fn requests_serialize_for_the_frontend() {
    let request = PromptRequest {
        id: Uuid::nil(),
        session_id: None,
        prompt: PromptKind::Password {
            connection_name: "web-01".into(),
            username: "deploy".into(),
            host: "10.0.0.12".into(),
            can_save: true,
            retry: false,
        },
    };
    assert_eq!(
        serde_json::to_value(&request).unwrap(),
        json!({
            "id": "00000000-0000-0000-0000-000000000000",
            "sessionId": null,
            "prompt": {
                "kind": "password",
                "connectionName": "web-01",
                "username": "deploy",
                "host": "10.0.0.12",
                "canSave": true,
                "retry": false
            }
        })
    );

    let interactive = PromptKind::KeyboardInteractive {
        connection_name: "web-01".into(),
        name: String::new(),
        instructions: String::new(),
        prompts: vec![InteractivePrompt {
            text: "Code: ".into(),
            echo: true,
        }],
    };
    let value = serde_json::to_value(&interactive).unwrap();
    assert_eq!(value["kind"], "keyboardInteractive");
    assert_eq!(
        value["prompts"],
        json!([{ "text": "Code: ", "echo": true }])
    );

    assert_eq!(
        serde_json::to_value(host_key()).unwrap()["keyType"],
        "ssh-ed25519"
    );
}

#[test]
fn answers_deserialize_from_the_frontend() {
    let secret: PromptAnswer =
        serde_json::from_value(json!({ "kind": "secret", "value": "hunter2", "save": true }))
            .unwrap();
    // The value never shows up in a Debug print (S3).
    assert!(!format!("{secret:?}").contains("hunter2"));
    match secret {
        PromptAnswer::Secret { value, save } => {
            assert_eq!(value.expose(), "hunter2");
            assert!(save);
        }
        other => panic!("unexpected answer: {other:?}"),
    }

    let responses: PromptAnswer =
        serde_json::from_value(json!({ "kind": "responses", "values": ["123456"] })).unwrap();
    assert!(
        matches!(responses, PromptAnswer::Responses { ref values } if values.len() == 1 && values[0].expose() == "123456")
    );

    for (kind, expected) in [
        ("accept", "Accept"),
        ("reject", "Reject"),
        ("cancel", "Cancel"),
    ] {
        let answer: PromptAnswer = serde_json::from_value(json!({ "kind": kind })).unwrap();
        assert_eq!(format!("{answer:?}"), expected);
    }
}
```

### `src-tauri/src/ssh/known_hosts_tests.rs`

```rust
use std::os::unix::fs::PermissionsExt;

use russh::keys::{PublicKey, parse_public_key_base64};

use super::known_hosts::{HostKeyStatus, KnownHosts, fingerprint, host_pattern};

// Fixed test keys (public halves only), generated once with `ssh-keygen`.
const KEY_A: &str = "AAAAC3NzaC1lZDI1NTE5AAAAINaLEe/SaLSsJfe8JpeWmS3B21Uw+eO2V8colcGPyFu7";
const FP_A: &str = "SHA256:9nFwX3ZbD2Afu2zLS84SR45AYIjQN+xcUO69FYBIWrM";
const KEY_B: &str = "AAAAC3NzaC1lZDI1NTE5AAAAIJ9JkVFSefDuVr/cYSAh/f1rWdn5C+BjFEYycTOLh8+l";
const FP_B: &str = "SHA256:K65as0l6lNg1myP2r9czzcwbzLSZhdI6QVPLB/Nx2QI";
const KEY_EC: &str = "AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBG+hjIUfFDzc5XLJ/LvCqK1FO7u10XSVbfBvwNlHcqltQv5LGg8ZQxugdmnnA5I3KdTvCB+Z9mfjxKRpooFj+Sk=";

fn key(base64: &str) -> PublicKey {
    parse_public_key_base64(base64).unwrap()
}

/// The own file and the user file, with the given contents ("" = the file does not exist).
fn files(own: &str, user: &str) -> (tempfile::TempDir, KnownHosts) {
    let dir = tempfile::tempdir().unwrap();
    let own_path = dir.path().join("own_known_hosts");
    let user_path = dir.path().join("user_known_hosts");
    if !own.is_empty() {
        std::fs::write(&own_path, own).unwrap();
    }
    if !user.is_empty() {
        std::fs::write(&user_path, user).unwrap();
    }
    (dir, KnownHosts::new(own_path, Some(user_path)))
}

#[test]
fn host_patterns_follow_openssh() {
    assert_eq!(host_pattern("db.internal", 22), "db.internal");
    assert_eq!(host_pattern("127.0.0.1", 2222), "[127.0.0.1]:2222");
}

#[test]
fn fingerprints_are_sha256_base64() {
    assert_eq!(fingerprint(&key(KEY_A)), FP_A);
    assert_eq!(fingerprint(&key(KEY_B)), FP_B);
}

#[test]
fn for_app_keeps_its_own_file_in_the_config_dir() {
    let dir = tempfile::tempdir().unwrap();
    let known = KnownHosts::for_app(dir.path());
    assert_eq!(known.own, dir.path().join("known_hosts"));
    if let Some(user) = &known.user {
        assert!(user.ends_with(".ssh/known_hosts"));
    }
}

#[test]
fn a_host_in_neither_file_is_unknown() {
    let (_dir, known) = files("", "");
    assert_eq!(
        known.check("db.internal", 22, &key(KEY_A)),
        HostKeyStatus::Unknown
    );
}

#[test]
fn the_user_file_is_trusted() {
    let (_dir, known) = files("", &format!("db.internal ssh-ed25519 {KEY_A}\n"));
    assert_eq!(
        known.check("db.internal", 22, &key(KEY_A)),
        HostKeyStatus::Known
    );
}

#[test]
fn a_non_default_port_uses_brackets() {
    let (_dir, known) = files(&format!("[db.internal]:2222 ssh-ed25519 {KEY_A}\n"), "");
    assert_eq!(
        known.check("db.internal", 2222, &key(KEY_A)),
        HostKeyStatus::Known
    );
    assert_eq!(
        known.check("db.internal", 22, &key(KEY_A)),
        HostKeyStatus::Unknown
    );
}

#[test]
fn a_different_key_of_the_same_type_is_changed() {
    let (_dir, known) = files(&format!("db.internal ssh-ed25519 {KEY_B}\n"), "");
    match known.check("db.internal", 22, &key(KEY_A)) {
        HostKeyStatus::Changed {
            path,
            line,
            known_fingerprint,
            removable,
        } => {
            assert_eq!(path, known.own);
            assert_eq!(line, 1);
            assert_eq!(known_fingerprint, FP_B);
            assert!(removable);
        }
        other => panic!("expected Changed, got {other:?}"),
    }
}

#[test]
fn a_changed_key_in_the_user_file_is_not_removable() {
    let (_dir, known) = files("", &format!("db.internal ssh-ed25519 {KEY_B}\n"));
    assert!(matches!(
        known.check("db.internal", 22, &key(KEY_A)),
        HostKeyStatus::Changed {
            removable: false,
            ..
        }
    ));
}

#[test]
fn a_key_of_another_type_is_unknown_not_changed() {
    let (_dir, known) = files(&format!("db.internal ecdsa-sha2-nistp256 {KEY_EC}\n"), "");
    assert_eq!(
        known.check("db.internal", 22, &key(KEY_A)),
        HostKeyStatus::Unknown
    );
}

#[test]
fn a_match_in_either_file_wins_over_a_change_in_the_other() {
    let (_dir, known) = files(
        &format!("db.internal ssh-ed25519 {KEY_B}\n"),
        &format!("db.internal ssh-ed25519 {KEY_A}\n"),
    );
    assert_eq!(
        known.check("db.internal", 22, &key(KEY_A)),
        HostKeyStatus::Known
    );
}

#[test]
fn an_unreadable_file_is_skipped_not_fatal() {
    // russh fails on a matching line whose key does not parse: that file counts as empty, the other still counts.
    let (_dir, known) = files(
        "db.internal ssh-ed25519 not-base64!\n",
        &format!("db.internal ssh-ed25519 {KEY_A}\n"),
    );
    assert_eq!(
        known.check("db.internal", 22, &key(KEY_A)),
        HostKeyStatus::Known
    );
}

#[test]
fn learning_appends_to_the_own_file_only_with_mode_0600() {
    let (_dir, known) = files("", "");
    known.learn("127.0.0.1", 2222, &key(KEY_A)).unwrap();
    known.learn("db.internal", 22, &key(KEY_B)).unwrap();

    assert_eq!(
        known.check("127.0.0.1", 2222, &key(KEY_A)),
        HostKeyStatus::Known
    );
    assert_eq!(
        known.check("db.internal", 22, &key(KEY_B)),
        HostKeyStatus::Known
    );
    let mode = std::fs::metadata(&known.own).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o600);
    assert!(!known.user.as_ref().unwrap().exists());

    let text = std::fs::read_to_string(&known.own).unwrap();
    assert_eq!(text.lines().count(), 2);
    assert!(text.lines().all(|line| !line.starts_with('#')));
}

#[test]
fn removing_drops_every_line_of_that_host_from_the_own_file() {
    let own = format!(
        "[db.internal]:2222 ssh-ed25519 {KEY_A}\nother.host ssh-ed25519 {KEY_B}\n[db.internal]:2222 ecdsa-sha2-nistp256 {KEY_EC}\n"
    );
    let user = format!("[db.internal]:2222 ssh-ed25519 {KEY_A}\n");
    let (_dir, known) = files(&own, &user);

    assert_eq!(known.remove("db.internal", 2222).unwrap(), 2);
    assert_eq!(
        std::fs::read_to_string(&known.own).unwrap(),
        format!("other.host ssh-ed25519 {KEY_B}\n")
    );
    // The user's OpenSSH file is never modified (D10).
    assert_eq!(
        std::fs::read_to_string(known.user.as_ref().unwrap()).unwrap(),
        user
    );
    assert_eq!(known.remove("db.internal", 2222).unwrap(), 0);
}

#[test]
fn removing_from_a_missing_file_removes_nothing() {
    let (_dir, known) = files("", "");
    assert_eq!(known.remove("db.internal", 22).unwrap(), 0);
    assert!(!known.own.exists());
}
```

### `src-tauri/src/ssh/error_tests.rs`

```rust
use super::error::{SshError, map_russh_error};
use crate::error::{AppError, ErrorKind};

#[test]
fn russh_errors_map_to_app_error_kinds() {
    let cases = [
        (russh::Error::UnknownKey, ErrorKind::HostKeyRejected),
        (russh::Error::WrongServerSig, ErrorKind::HostKeyRejected),
        (
            russh::Error::KeyChanged { line: 3 },
            ErrorKind::HostKeyChanged,
        ),
        (russh::Error::ConnectionTimeout, ErrorKind::Timeout),
        (russh::Error::KeepaliveTimeout, ErrorKind::Timeout),
        (russh::Error::InactivityTimeout, ErrorKind::Timeout),
        (russh::Error::NoAuthMethod, ErrorKind::Auth),
        (russh::Error::NotAuthenticated, ErrorKind::Auth),
        (russh::Error::Disconnect, ErrorKind::Network),
        (russh::Error::HUP, ErrorKind::Network),
        (russh::Error::KexInit, ErrorKind::Network),
        (russh::Error::SendError, ErrorKind::Network),
    ];
    for (error, kind) in cases {
        assert_eq!(map_russh_error(&error).kind, kind, "{error:?}");
    }
}

#[test]
fn russh_text_is_never_copied_into_the_message() {
    // S7: russh errors are reworded; what the server or the OS sent is not repeated.
    let error = map_russh_error(&russh::Error::IO(std::io::Error::other(
        "remote said: s3cr3t",
    )));
    assert_eq!(error.kind, ErrorKind::Network);
    assert!(!error.message.contains("s3cr3t"));
}

#[test]
fn app_errors_pass_through_unchanged() {
    let original = AppError::new(ErrorKind::Cancelled, "prompt cancelled");
    let back: AppError = SshError::App(original.clone()).into();
    assert_eq!(back, original);

    let from_russh: AppError = SshError::Russh(russh::Error::UnknownKey).into();
    assert_eq!(from_russh.kind, ErrorKind::HostKeyRejected);
}
```

### `src-tauri/src/commands/ipc_prompts_tests.rs`

```rust
use serde_json::json;

use super::ipc_tests::{invoke, mock_app, ok};

#[test]
fn prompt_commands_accept_the_arguments_sent_by_ipc_ts() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());

    // Nothing is waiting for this id: the arguments were read, the broker answered "not found".
    let error = invoke(
        &webview,
        "prompt_answer",
        json!({
            "id": "5b6f2d3e-0000-4000-8000-000000000001",
            "answer": { "kind": "secret", "value": "x", "save": false }
        }),
    )
    .unwrap_err();
    assert_eq!(error["kind"], "notFound");

    // TunL's own known_hosts is empty in a fresh config dir.
    let removed = ok(
        &webview,
        "known_host_remove",
        json!({ "host": "db.internal", "port": 2222 }),
    );
    assert_eq!(removed, json!(0));
}
```

### `src-tauri/tests/support/mod.rs` (partagé par les tests d'intégration `ssh_*` (T17, T18, T19))

```rust
//! Shared by the `ssh_*` integration tests (feature `test-env`): the podman environment of T16, contexts, and a
//! prompt responder. Each test crate uses part of it only.
#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh::client::Handle;
use serde_json::Value;
use tunl_lib::error::AppResult;
use tunl_lib::prompts::{PromptAnswer, PromptBroker, PromptRequest};
use tunl_lib::secrets::SecretStore;
use tunl_lib::ssh::SshContext;
use tunl_lib::ssh::connect::{client_config, handshake, tcp_connect};
use tunl_lib::ssh::handler::{ClientHandler, HostKeyTarget};
use tunl_lib::ssh::known_hosts::KnownHosts;

/// `scripts/test-env/.state/env.json`, written by `npm run test-env:up`.
pub struct TestEnv {
    raw: Value,
}

impl TestEnv {
    pub fn load() -> Self {
        let path =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../scripts/test-env/.state/env.json");
        let text = std::fs::read_to_string(&path).unwrap_or_else(|_| {
            panic!(
                "{} is missing: run `npm run test-env:up` first",
                path.display()
            )
        });
        Self {
            raw: serde_json::from_str(&text).unwrap(),
        }
    }

    fn text(&self, pointer: &str) -> String {
        self.raw
            .pointer(pointer)
            .and_then(Value::as_str)
            .unwrap_or_else(|| panic!("env.json has no {pointer}"))
            .to_string()
    }

    pub fn user(&self) -> String {
        self.text("/user")
    }
    pub fn password(&self) -> String {
        self.text("/password")
    }
    pub fn passphrase(&self) -> String {
        self.text("/passphrase")
    }
    /// `which` = "target" | "bastion" | "hidden".
    pub fn host(&self, which: &str) -> String {
        self.text(&format!("/{which}/host"))
    }
    pub fn port(&self, which: &str) -> u16 {
        self.raw
            .pointer(&format!("/{which}/port"))
            .and_then(Value::as_u64)
            .and_then(|port| u16::try_from(port).ok())
            .unwrap_or_else(|| panic!("env.json has no /{which}/port"))
    }
    /// `which` = "ed25519" | "ed25519Passphrase" | "rsa".
    pub fn key(&self, which: &str) -> String {
        self.text(&format!("/keys/{which}"))
    }
    pub fn known_hosts(&self) -> PathBuf {
        PathBuf::from(self.text("/knownHosts"))
    }
    /// `SHA256:…` of a server's host key.
    pub fn host_key(&self, which: &str) -> String {
        self.text(&format!("/hostKeys/{which}"))
    }
}

/// A context whose own known_hosts lives in `own_dir` (empty at first) and whose user file is the environment's
/// `known_hosts`: the three servers are trusted.
pub fn context(
    env: &TestEnv,
    own_dir: &Path,
    prompts: Arc<PromptBroker>,
    secrets: SecretStore,
) -> SshContext {
    SshContext {
        known_hosts: Arc::new(KnownHosts::new(
            own_dir.join("known_hosts"),
            Some(env.known_hosts()),
        )),
        prompts,
        secrets: Arc::new(secrets),
        agent_socket: None,
    }
}

/// Same, without a user file: every server is unknown until it is learned in `own_dir`.
pub fn blank_context(
    own_dir: &Path,
    prompts: Arc<PromptBroker>,
    secrets: SecretStore,
) -> SshContext {
    SshContext {
        known_hosts: Arc::new(KnownHosts::new(own_dir.join("known_hosts"), None)),
        prompts,
        secrets: Arc::new(secrets),
        agent_socket: None,
    }
}

pub type Asked = Arc<Mutex<Vec<PromptRequest>>>;

/// Answers each prompt, at once, with the next answer of `script` (`Cancel` once it runs out), and records every
/// request. Installs itself as the broker's emitter.
pub fn respond(broker: &Arc<PromptBroker>, script: Vec<PromptAnswer>) -> Asked {
    let asked: Asked = Arc::new(Mutex::new(Vec::new()));
    let record = asked.clone();
    let answers = Arc::new(Mutex::new(script.into_iter()));
    let weak = Arc::downgrade(broker);
    broker.set_emitter(Box::new(move |request| {
        record.lock().unwrap().push(request.clone());
        let answer = answers
            .lock()
            .unwrap()
            .next()
            .unwrap_or(PromptAnswer::Cancel);
        if let Some(broker) = weak.upgrade() {
            broker.answer(request.id, answer).unwrap();
        }
    }));
    asked
}

pub fn host_key_target(env: &TestEnv, which: &str) -> HostKeyTarget {
    HostKeyTarget {
        host: env.host(which),
        port: env.port(which),
        session_id: None,
    }
}

/// TCP, then the SSH handshake with `which`'s host key checked against `ctx`. Not authenticated yet.
pub async fn connect(
    env: &TestEnv,
    ctx: &SshContext,
    which: &str,
) -> AppResult<Handle<ClientHandler>> {
    let stream = tcp_connect(&env.host(which), env.port(which), Duration::from_secs(5)).await?;
    handshake(stream, host_key_target(env, which), client_config(15), ctx).await
}
```

### `src-tauri/tests/ssh_hostkey.rs` (contre podman : `npm run test:ssh`)

```rust
//! T17 against the podman servers of T16: host key trust, prompts, refusals. `npm run test:ssh`.
#![cfg(feature = "test-env")]

mod support;

use std::os::unix::fs::PermissionsExt;
use std::sync::Arc;
use std::time::Duration;

use support::{TestEnv, blank_context, connect, context, host_key_target, respond};
use tunl_lib::error::{ErrorDetail, ErrorKind};
use tunl_lib::prompts::{PromptAnswer, PromptBroker, PromptKind};
use tunl_lib::secrets::SecretStore;
use tunl_lib::ssh::connect::{client_config, handshake, tcp_connect};
use uuid::Uuid;

#[tokio::test]
async fn a_host_trusted_by_the_user_file_connects_without_a_prompt() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let broker = Arc::new(PromptBroker::new());
    let asked = respond(&broker, vec![]);
    let ctx = context(&env, dir.path(), broker, SecretStore::memory());

    let handle = connect(&env, &ctx, "target").await.unwrap();
    assert!(!handle.is_closed());
    assert!(asked.lock().unwrap().is_empty());
    assert!(!dir.path().join("known_hosts").exists(), "nothing to learn");
}

#[tokio::test]
async fn an_unknown_host_is_learned_once_accepted() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let broker = Arc::new(PromptBroker::new());
    let asked = respond(&broker, vec![PromptAnswer::Accept]);
    let ctx = blank_context(dir.path(), broker, SecretStore::memory());

    connect(&env, &ctx, "target").await.unwrap();
    {
        let asked = asked.lock().unwrap();
        assert_eq!(asked.len(), 1);
        assert_eq!(
            asked[0].prompt,
            PromptKind::HostKeyUnknown {
                host: env.host("target"),
                port: env.port("target"),
                key_type: "ssh-ed25519".into(),
                fingerprint: env.host_key("target"),
            }
        );
    }

    let own = dir.path().join("known_hosts");
    let text = std::fs::read_to_string(&own).unwrap();
    assert!(text.starts_with(&format!(
        "[{}]:{} ssh-ed25519 ",
        env.host("target"),
        env.port("target")
    )));
    assert_eq!(
        std::fs::metadata(&own).unwrap().permissions().mode() & 0o777,
        0o600
    );

    // Learned: the second connection asks nothing.
    connect(&env, &ctx, "target").await.unwrap();
    assert_eq!(asked.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn a_rejected_or_cancelled_host_key_stops_the_connection() {
    let env = TestEnv::load();
    for answer in [PromptAnswer::Reject, PromptAnswer::Cancel] {
        let dir = tempfile::tempdir().unwrap();
        let broker = Arc::new(PromptBroker::new());
        respond(&broker, vec![answer]);
        let ctx = blank_context(dir.path(), broker, SecretStore::memory());

        let error = connect(&env, &ctx, "target").await.err().unwrap();
        assert_eq!(error.kind, ErrorKind::HostKeyRejected);
        assert!(!dir.path().join("known_hosts").exists());
    }
}

#[tokio::test]
async fn an_unanswered_host_key_prompt_times_out_as_cancelled() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let broker = Arc::new(PromptBroker::with_timeout(Duration::from_millis(300)));
    broker.set_emitter(Box::new(|_| {}));
    let ctx = blank_context(dir.path(), broker, SecretStore::memory());

    let error = connect(&env, &ctx, "target").await.err().unwrap();
    assert_eq!(error.kind, ErrorKind::Cancelled);
}

#[tokio::test]
async fn a_changed_host_key_is_refused_with_both_fingerprints() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    // The bastion's key, recorded under the target's name: the target now presents "another" key.
    let bastion = format!("[{}]:{} ", env.host("bastion"), env.port("bastion"));
    let target = format!("[{}]:{} ", env.host("target"), env.port("target"));
    let recorded = std::fs::read_to_string(env.known_hosts()).unwrap();
    let line = recorded.lines().find(|l| l.starts_with(&bastion)).unwrap();
    let own = dir.path().join("known_hosts");
    std::fs::write(&own, format!("{}\n", line.replacen(&bastion, &target, 1))).unwrap();

    let broker = Arc::new(PromptBroker::new());
    let asked = respond(&broker, vec![PromptAnswer::Accept]);
    let ctx = blank_context(dir.path(), broker, SecretStore::memory());

    let error = connect(&env, &ctx, "target").await.err().unwrap();
    assert_eq!(error.kind, ErrorKind::HostKeyChanged);
    assert_eq!(
        error.detail.as_deref(),
        Some(&ErrorDetail::HostKeyChanged {
            host: env.host("target"),
            port: env.port("target"),
            key_type: "ssh-ed25519".into(),
            fingerprint: env.host_key("target"),
            known_fingerprint: env.host_key("bastion"),
            known_hosts_path: own.to_string_lossy().into_owned(),
            line: 1,
            removable: true,
        })
    );
    assert!(
        asked.lock().unwrap().is_empty(),
        "no « continue anyway » (S6)"
    );
}

#[tokio::test]
async fn prompts_carry_the_session_id() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let broker = Arc::new(PromptBroker::new());
    let asked = respond(&broker, vec![PromptAnswer::Accept]);
    let ctx = blank_context(dir.path(), broker, SecretStore::memory());

    let session = Uuid::new_v4();
    let mut target = host_key_target(&env, "bastion");
    target.session_id = Some(session);
    let stream = tcp_connect(
        &env.host("bastion"),
        env.port("bastion"),
        Duration::from_secs(5),
    )
    .await
    .unwrap();
    handshake(stream, target, client_config(0), &ctx)
        .await
        .unwrap();
    assert_eq!(asked.lock().unwrap()[0].session_id, Some(session));
}

#[tokio::test]
async fn a_closed_port_is_a_network_error() {
    let error = tcp_connect("127.0.0.1", 1, Duration::from_secs(2))
        .await
        .err()
        .unwrap();
    assert_eq!(error.kind, ErrorKind::Network);
    assert!(error.message.contains("127.0.0.1:1"), "{}", error.message);
}
```


## Étapes

1. Les tests : `node scripts/contract-tests.mjs T17`.
2. `Cargo.toml`, `package.json` (scripts), `error.rs` (deux champs + le littéral du test).
3. `prompts.rs`, puis `cargo test prompts` jusqu'au vert.
4. `ssh/known_hosts.rs` et `ssh/error.rs`, puis `cargo test ssh::`.
5. `ssh/handler.rs`, `ssh/connect.rs`, `AppState`, `lib.rs`, `commands/prompts.rs`, puis `npm run bindings` et
   `npm run verify:rust`.
6. `npm run test:ssh` (il démarre les conteneurs) jusqu'au vert.
7. `ipc.ts`, `lib/mock/prompts.ts`, puis `npx vitest run src/lib`.
8. `npm run format`, `npm run review`, cases, statut, commit `feat: SSH handshake, host key trust and prompt broker (T17)`.

## Critères d'acceptation

- [ ] `npm run review` passe (avec `test:ssh`), et `node scripts/contract-tests.mjs T17 --check` affiche `OK` partout.
- [ ] `grep -rn "learn_known_hosts" src-tauri/src` ne trouve rien (voir les pièges).
- [ ] Aucun secret ni texte d'erreur russh dans un `AppError.message` (tests `ssh::error_tests`).

## À regarder par Florian

Rien à l'écran : le premier onglet SSH arrive en T21. `npm run test:ssh` montre les sept scénarios contre les
conteneurs (clé connue, apprise, refusée, changée…).
