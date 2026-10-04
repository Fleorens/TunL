# T17 — Prompts et `known_hosts` : `PromptBroker`, fichier des clés d'hôte, erreurs SSH

| | |
|---|---|
| **Jalon** | M2 — SSH |
| **Dépend de** | T12 |
| **Lire avant** | `docs/01-architecture.md` §7, `docs/06-securite.md` §2 (S3, S6, S7, S9), `docs/02-decisions.md` D10 |
| **Livrable** | `prompts.rs`, `ssh/` (`mod`, `known_hosts`, `error`), commandes `prompt_answer` et `known_host_remove`, leur pendant dans `ipc.ts` et le mock ; 26 tests Rust, 1 test IPC |

## Pourquoi

Première moitié du noyau SSH : tout ce qui se construit et se teste **sans serveur**. Le `PromptBroker` pose une
question à l'utilisateur (« faites-vous confiance à cette clé ? », « mot de passe ? ») et attend sa réponse. Le
fichier `known_hosts` de TunL dit si la clé d'un serveur est connue, inconnue ou **changée** (S6). Les erreurs de
russh deviennent des `AppError` qui ne recopient rien de ce que le serveur a envoyé (S7). T17b branchera ces trois
briques sur une vraie poignée de main, contre les conteneurs de T16.

Tout ce qui touche russh a été **prototypé par l'orchestrateur** (russh 0.63.3) : les appels et les pièges
ci-dessous sont vérifiés. Tu n'as rien à explorer dans la crate.

## À réutiliser (ne pas réécrire)

- `AppError::new`, `AppError::validation`, `AppError::not_found`, `AppError::internal`, `with_detail`, `ErrorDetail`
  (`error.rs`) ; `SecretStore`, `SecretValue` (`secrets.rs`, T12) ; `AppPaths` (`paths.rs`).
- Le patron des tests IPC : `mock_app`, `invoke`, `ok` de `commands/ipc_tests.rs`.

## Contrat — Rust

### Dépendance (`src-tauri/Cargo.toml`)

```toml
russh = "0.63"          # features par défaut (aws-lc-rs) ; les clés sont dans russh::keys, pas de crate russh-keys
```

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
pub mod error; pub mod known_hosts;
#[cfg(test)] mod error_tests;
#[cfg(test)] mod known_hosts_tests;
```

T17b y ajoutera `handler`, `connect` et `SshContext`.

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

### `AppState` et `lib.rs`

- Nouveaux champs : `pub secrets: Arc<SecretStore>` (était `SecretStore` : les appels `state.secrets.set(…)` ne
  changent pas), `pub prompts: Arc<PromptBroker>`, `pub known_hosts: Arc<KnownHosts>` (`KnownHosts::for_app`).
  `from_disk(paths, now_ms, secrets)` garde sa signature et construit ces champs.
- `pub fn blocked(paths: &AppPaths, now_ms: i64, error: AppError, secrets: SecretStore) -> Self` : l'état de repli
  que `lib.rs` construisait à la main (store bloqué, réglages par défaut). Les champs futurs ne toucheront plus `lib.rs`.
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

## Étapes

1. Les tests : `node scripts/contract-tests.mjs T17`.
2. `Cargo.toml`, `error.rs` (deux champs + le littéral du test).
3. `prompts.rs`, puis `cargo test prompts` jusqu'au vert.
4. `ssh/mod.rs`, `ssh/known_hosts.rs`, `ssh/error.rs`, puis `cargo test ssh::`.
5. `AppState`, `lib.rs`, `commands/prompts.rs`, puis `npm run bindings` et `npm run verify:rust`.
6. `ipc.ts`, `lib/mock/prompts.ts`, puis `npx vitest run src/lib`.
7. `npm run format`, `npm run review`, cases, statut, commit `feat: prompt broker, known_hosts file and SSH errors (T17)`.

## Critères d'acceptation

- [x] `npm run review` passe, et `node scripts/contract-tests.mjs T17 --check` affiche `OK` partout.
- [x] `grep -rn "learn_known_hosts" src-tauri/src` ne trouve rien (voir les pièges).
- [x] Aucun secret ni texte d'erreur russh dans un `AppError.message` (tests `ssh::error_tests`).

## À regarder par Florian

Rien à l'écran : T17b branche ces briques sur une vraie connexion, le premier onglet SSH arrive en T21.
