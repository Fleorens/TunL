# T17b — Poignée de main SSH : TCP, confiance dans la clé d'hôte, tests contre podman

| | |
|---|---|
| **Jalon** | M2 — SSH |
| **Dépend de** | T17, T16 |
| **Lire avant** | `docs/01-architecture.md` §5, `docs/02-decisions.md` D03, `docs/07-dev.md` §5 |
| **Livrable** | `ssh/handler.rs`, `ssh/connect.rs`, `SshContext`, feature Cargo `test-env`, script `test:ssh` ; 7 tests d'intégration contre podman |

## Pourquoi

Seconde moitié du noyau SSH : ouvrir le TCP, négocier la session SSH avec russh (sans le binaire `ssh`, D03) et
**décider de faire confiance ou non à la clé du serveur** avec les briques de T17 : clé connue → on continue ; clé
inconnue → on demande par le `PromptBroker` ; clé différente de celle connue → refus net, sans « continuer quand
même » (S6). L'authentification (T18) et le shell (T19) se brancheront sur cette poignée de main.

C'est aussi la première fiche testée contre de **vrais serveurs** : les conteneurs de T16, par `npm run test:ssh`,
qui entre dans `npm run review`. Toute la séquence a été prototypée contre eux par l'orchestrateur.

## À réutiliser (ne pas réécrire)

- T17 : `KnownHosts` (`check`, `learn`), `HostKeyStatus`, `fingerprint`, `PromptBroker::ask`, `PromptKind`,
  `PromptAnswer`, `SshError`, `map_russh_error` ; `AppError::with_detail`, `ErrorDetail::HostKeyChanged`.
- L'environnement podman de T16 : `npm run test-env:up`, `scripts/test-env/.state/env.json`.

## Contrat — Rust

### Feature et scripts

`src-tauri/Cargo.toml` :

```toml
[features]
# Integration tests against the podman servers of T16 (`npm run test:ssh`).
test-env = []
```

### Scripts npm (`package.json`)

```json
"test:ssh": "npm run test-env:up && cd src-tauri && cargo test --features test-env --test 'ssh_*'",
"verify:rust": "cd src-tauri && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings && cargo test",
"review": "npm run verify && npm run test:ssh && npm run e2e"
```

`--all-features` fait passer clippy sur les tests d'intégration, qui ne compilent qu'avec `test-env`. Sans cette
feature, `cargo test` les ignore : `verify` ne dépend donc pas de podman, `review` si.

### `SshContext` (dans `src-tauri/src/ssh/mod.rs`, qui déclare aussi `pub mod connect; pub mod handler;`)

```rust
/// Everything a connection needs besides its target. Cheap to clone.
#[derive(Clone)]
pub struct SshContext {
    pub known_hosts: Arc<KnownHosts>,
    pub prompts: Arc<PromptBroker>,
    pub secrets: Arc<SecretStore>,          // used from T18
    pub agent_socket: Option<PathBuf>,      // SSH_AUTH_SOCK, used from T18
}
```

`AppState` : `pub fn ssh_context(&self) -> SshContext` : les trois `Arc` clonés,
`agent_socket = std::env::var_os("SSH_AUTH_SOCK").map(PathBuf::from)`.

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

## Pièges (vus au prototype)

- Le trait `Handler` refuse toute clé par défaut (`Ok(false)` → russh renvoie `UnknownKey`) : toujours passer par
  `known_hosts.check`.
- `npm run test:ssh` recrée les conteneurs à chaque passage (2 à 3 s) : c'est normal. Il se lance **depuis la
  racine du dépôt**.

## Tests du contrat

### `src-tauri/tests/support/mod.rs` (partagé par les tests d'intégration `ssh_*` (T17b, T18, T19))

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

1. Les tests : `node scripts/contract-tests.mjs T17b`.
2. `Cargo.toml` (feature), `package.json` (scripts).
3. `SshContext` et `AppState::ssh_context`, `ssh/handler.rs`, `ssh/connect.rs`, puis `npm run verify:rust`.
4. `npm run test:ssh` (il démarre les conteneurs) jusqu'au vert.
5. `npm run format`, `npm run review`, cases, statut, commit `feat: SSH handshake with host key trust (T17b)`.

## Critères d'acceptation

- [ ] `npm run review` passe (avec `test:ssh`), et `node scripts/contract-tests.mjs T17b --check` affiche `OK` partout.
  (contrats OK partout ; `test:ssh` vert, 7/7 ; `verify` du `.devbox/check` vert — l'étape `e2e` de `review` est
  bloquée par une **librairie système absente**, `libnspr4.so`, dans le bac à sable, hors du dépôt ; voir le compte
  rendu)
- [x] Le délai de connexion ne couvre que le TCP : `tokio::time::timeout` n'apparaît pas autour de `handshake`.

## À regarder par Florian

Rien à l'écran (T21). `npm run test:ssh` montre les sept scénarios contre les conteneurs : clé connue, apprise,
refusée, changée, délai de réponse dépassé, port fermé.
