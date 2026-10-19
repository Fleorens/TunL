# T28 — RDP : lancement de FreeRDP par stdin, suivi du processus, journal filtré, tunnel via bastion (+ ipc et mock)

| | |
|---|---|
| **Jalon** | M5 — RDP |
| **Dépend de** | T23, T27 |
| **Lire avant** | `docs/01-architecture.md` §8, `docs/02-decisions.md` D04, `docs/06-securite.md` **S2, S4**, S5 et **S8** |
| **Livrable** | `rdp/launch.rs`, `rdp/session.rs`, commande `rdp_open` + `ipc.rdpOpen` + mock ; 4 fichiers de tests (dont 1 contre podman, 1 qui remplace celui de T27) |

## Pourquoi

T27 sait trouver FreeRDP et construire ses arguments. Cette fiche le **lance** pour un onglet RDP :
- une connexion directe : FreeRDP se connecte à l'hôte ;
- une connexion derrière un bastion : TunL établit le lien SSH jusqu'au bastion (`establish`, T23), ouvre un
  **tunnel local** vers l'hôte RDP (`forward`, T23), et FreeRDP se connecte à `127.0.0.1:<port>`.

FreeRDP reçoit **un seul** argument, `/args-from:stdin` ; le reste (mot de passe compris) part sur son stdin, une ligne
par argument, puis stdin est fermé (S4). Le mot de passe vient du trousseau, lu par le Rust (S2) ; sans mot de passe
enregistré, FreeRDP le demande dans sa propre fenêtre. Ses sorties deviennent des `SessionEvent::Log`, filtrées (S8).

L'interface (la carte RDP de l'onglet) vient avec T28b : ici, le backend, l'IPC et le mock.

Prototypé par l'orchestrateur, **avec un faux FreeRDP** (un script) : il enregistre sa ligne de commande et son stdin ;
contre podman, il lit `/v:` et se connecte au tunnel, qui mène à l'hôte caché derrière le bastion. Les tests de cette
fiche passent.

## À réutiliser (ne pas réécrire)

- T27 : `rdp::detect::{detect, VERSION_TIMEOUT, spawn_retrying}`, `rdp::args::{build_args, RdpEndpoint,
  RdpCredentials, RdpArgs}` (`stdin_text`).
- T23 : `ssh::link::{establish, SshLink}` (`disconnect`), `ssh::forward::{bind_local, forward}`.
- T19 / T29 : `ssh::session::{resolve_target, default_username, connect_step, SessionTarget, SshTarget}`,
  `wol::{wake_target, run_wake_step, WAKE_POLL_INTERVAL}`.
- T24 : `commands::sftp::EventSink` (un onglet qui n'envoie que des événements) : le passer en `pub(crate)`, ainsi
  que son champ `on_event`, et l'utiliser ici. **Ne pas en écrire un second.**
- T12 : `SecretStore::get(connection_id, SecretKind::Password)`.
- Mock : `lib/mock/sessions.ts` (`sessions`, `scheduler`, `LiveSession`), `lib/mock/rdp.ts`,
  `jumpChainNames` (`features/connections/jump-hosts.ts`).

## Contrat — Rust

### `src-tauri/src/rdp/launch.rs` (nouveau)

```rust
pub const MAX_LOG_LINE: usize = 300;
/// Une ligne de FreeRDP telle qu'on peut la montrer (S8), ou None.
pub fn filter_log_line(line: &str) -> Option<String>;
/// Lance `client` avec `/args-from:stdin`, écrit `args.stdin_text()` sur son stdin, le ferme.
pub async fn launch(client: &Path, args: &RdpArgs) -> AppResult<Child>;
/// Relaie stdout et stderr en `Log` jusqu'à la sortie du client, ou `cancel` (le client est tué).
pub async fn watch(child: Child, cancel: CancellationToken, sink: &dyn SessionSink) -> (CloseReason, Option<i32>);
```

| Fonction | Comportement |
|---|---|
| `filter_log_line` | `trim` ; vide → `None` ; contient (sans casse) `password`, `passwd`, `/p:`, `credential` ou `secret` → `None` ; sinon coupée à `MAX_LOG_LINE` **caractères** |
| `launch` | `Command::new(client).arg("/args-from:stdin")`, stdin / stdout / stderr en `piped`, `kill_on_drop(true)`, lancé par `spawn_retrying` ; échec → `ErrorKind::Rdp`, `"cannot start the RDP client"` (l'erreur système dans un `log::warn!`) ; écrire tout `stdin_text()`, puis **lâcher** stdin (c'est ce qui le ferme) |
| `watch` | lit stdout et stderr **ensemble** (`tokio::join!`), ligne par ligne, chaque ligne filtrée → `SessionEvent::Log` ; fin du processus → `(ProcessExited, code)` ; `cancel` → `start_kill`, `wait`, `(UserClosed, None)` ; erreur d'attente → `(Error, None)` |

### `src-tauri/src/rdp/session.rs` (nouveau ; `rdp/mod.rs` : `pub mod launch; pub mod session;` et `#[cfg(test)] mod launch_tests;`)

```rust
#[derive(Debug, Clone)]
pub struct RdpTarget {
    pub connection_id: Uuid, pub name: String, pub host: String, pub port: u16,
    pub username: Option<String>, pub settings: RdpSettings,
    /// Le bastion, en cible SSH avec sa propre chaîne ; None pour une connexion directe.
    pub via: Option<SshTarget>,
}
pub fn resolve_rdp(connection_id: Uuid, store: &Store, defaults: &SshDefaults, default_user: Option<&str>) -> AppResult<RdpTarget>;

pub struct RdpRun { pub id: Uuid, pub target: RdpTarget, pub credentials: RdpCredentials, pub client: PathBuf, pub cancel: CancellationToken }
pub async fn run_rdp_session(ctx: SshContext, run: RdpRun, sink: Arc<dyn SessionSink>);
```

- `resolve_rdp` : connexion absente → `not_found` ; pas RDP → `validation("protocol", "is not RDP")` ; `via` =
  `resolve_target(SessionTarget::Saved { connection_id: jump_host_id })` (le bastion garde sa chaîne, son
  utilisateur, son authentification).
- `run_rdp_session`, dans l'ordre :
  1. avec `via` : `establish(&ctx, via, …)` (arrêt sur `None`) ; le lien dans un `Arc<SshLink>` ; étape
     `connect_step(Open, "tunnel", bind_local)` ; puis un `Log` `"tunnel 127.0.0.1:<port> → <host>:<port>"` (la
     carte de T28b le montre) ; `forward(listener, &link.target, host, port, cancel.child_token())` dans une tâche
     `tokio::spawn` qui garde son `Arc` ; l'adresse de FreeRDP devient `127.0.0.1:<port>`. Échec du tunnel → le lien
     est fermé, on s'arrête ;
  2. étape `Launch`, libellée par le **nom de fichier** du client (`sdl-freerdp3`) : `build_args` **puis** `launch`
     dans le même travail (une valeur refusée échoue sur l'étape, et le client ne démarre pas) ;
  3. `Connected`, `watch`, puis `Closed { reason, exit_status }` ;
  4. à la fin, dans tous les cas : `cancel.cancel()` (le tunnel s'arrête) et `link.disconnect()`.

### `src-tauri/src/commands/rdp.rs` : `rdp_open`

```rust
#[tauri::command]
pub async fn rdp_open(state: State<'_, AppState>, session_id: Uuid, connection_id: Uuid, on_event: Channel<SessionEvent>) -> AppResult<()>
```

Dans l'ordre, avant de rien lancer (ces erreurs reviennent tout de suite) : `resolve_rdp`, **puis** `detect`
(`settings.rdp.clientPath`, `PATH`, `VERSION_TIMEOUT` : `RdpClientMissing` si aucun client). Puis : le mot de passe
du trousseau (une erreur du trousseau n'est pas fatale : `log::warn!` qui ne cite que le type d'erreur, et FreeRDP
demandera) ; `wake_target` ; inscription dans `state.sessions` (comme `sftp_open`) ; `spawn` : réveil éventuel,
`run_rdp_session`, `sessions.remove`. `lib.rs` : `commands::rdp::rdp_open` dans `invoke_handler()`.

## Contrat — Frontend

- `ipc.ts`, sous `rdpDetect` : `rdpOpen(sessionId, connectionId, onEvent)` → `call<void>("rdp_open", { sessionId,
  connectionId, onEvent })`, avec `onEvent` tel quel pour le mock et dans un `new Channel<SessionEvent>(onEvent)`
  dans Tauri.
- `lib/mock/rdp.ts` : extraire de `rdp_detect` une fonction exportée `mockDetect(state): RdpClient` (qui lève
  `rdpClientMissing`) ; `rdp_detect` l'appelle.
- `lib/mock/rdp-session.ts` (nouveau) : `MOCK_TUNNEL_PORT = 40123` et `rdpSessionHandlers` avec `rdp_open` :
  `sessionId` déjà ouvert → `validation` ; connexion absente → `notFound` ; pas RDP → `validation("protocol: is not
  RDP")` ; `mockDetect` ; puis, en tâche de fond, des étapes `started` / `done` : `wake` (nom de la connexion) si elle
  se réveille avant connexion ; un `hop` par bastion de la chaîne **du bastion** ; si bastion : `target`
  (`<hôte>:<port>` du bastion), `hostKey` (son hôte), `auth` (son utilisateur, `user` par défaut), `open` « tunnel »,
  et le `log` `"tunnel 127.0.0.1:40123 → <hôte>:<port>"` ; `launch` (nom de fichier du client) ; `connected` ; deux
  `log` : `"[INFO][com.freerdp.core] connected to <hôte>"` et `"[INFO][com.freerdp.client.sdl] desktop 1920x1080,
  32 bpp"`. L'onglet reste ouvert jusqu'à `session_close`.
- `ipc-mock.ts` : `...rdpSessionHandlers`.

## Pièges (vus au prototype)

- **`watch` et l'emprunt de `child`** : le futur qui lit les sorties et attend la fin emprunte `child` ; pour le tuer
  sur annulation, ce futur doit être **fini** (créé et consommé dans un bloc qui rend `Option<…>`), puis on appelle
  `start_kill` hors du bloc.
- `russh::client::Handle` n'est **pas** `Clone` : le lien vit dans un `Arc<SshLink>`, partagé avec la tâche du
  tunnel.
- `clippy::result_unit_err` : pas de `Result<_, ()>` public ; `establish` rend déjà un `Option`.
- Lancer un script qu'on vient d'écrire peut échouer en « text file busy » quand d'autres tests lancent des
  processus : `spawn_retrying` (T27).
- Le faux client des tests est un script `sh` ou `bash` : `printf '%s\n' "$@"` enregistre sa ligne de commande, `cat`
  son stdin. C'est ainsi que les tests vérifient S4 (la ligne de commande ne contient que `/args-from:stdin`).
- **`npm run test:ssh` recrée les conteneurs** avec les clés de ton clone : ne le lance jamais pendant qu'un autre
  clone l'utilise.

## Tests du contrat

### `src-tauri/src/rdp/launch_tests.rs` (nouveau)

```rust
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use super::args::{RdpCredentials, RdpEndpoint, build_args};
use super::launch::{MAX_LOG_LINE, filter_log_line, launch, watch};
use super::session::{RdpRun, RdpTarget, resolve_rdp, run_rdp_session};
use crate::error::ErrorKind;
use crate::model::{Connection, ConnectionInput, Protocol, RdpSettings, SshDefaults};
use crate::prompts::PromptBroker;
use crate::secrets::{SecretStore, SecretValue};
use crate::sessions::{CloseReason, SessionEvent, SessionSink, StepKind, StepState};
use crate::ssh::SshContext;
use crate::ssh::known_hosts::KnownHosts;
use crate::store::Store;

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
    fn logs(&self) -> Vec<String> {
        self.events()
            .into_iter()
            .filter_map(|e| match e {
                SessionEvent::Log { line } => Some(line),
                _ => None,
            })
            .collect()
    }
}

/// A fake FreeRDP in `dir`: it saves its command line (`argv`) and its stdin (`stdin`), prints two lines on stdout
/// (one of them about a password) and one on stderr, runs `then`, and exits with `code`.
fn fake_client(dir: &Path, then: &str, code: i32) -> PathBuf {
    let path = dir.join("fake-freerdp");
    let script = format!(
        "#!/bin/sh\nprintf '%s\\n' \"$@\" > '{d}/argv'\ncat > '{d}/stdin'\n\
         echo '[INFO] connected to the server'\necho '[WARN] Password: hunter2'\n\
         echo '[ERROR] bitmap cache full' >&2\n{then}\nexit {code}\n",
        d = dir.display()
    );
    std::fs::write(&path, script).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path
}

fn endpoint() -> RdpEndpoint<'static> {
    RdpEndpoint {
        name: "ad-01",
        host: "10.0.0.5",
        port: 3389,
    }
}

fn admin() -> RdpCredentials {
    RdpCredentials {
        username: Some("admin".into()),
        password: Some(SecretValue::new("s3cret")),
    }
}

#[test]
fn log_lines_are_trimmed_cut_and_never_carry_a_credential() {
    assert_eq!(
        filter_log_line("  [INFO] connected  ").as_deref(),
        Some("[INFO] connected")
    );
    assert_eq!(filter_log_line("   "), None);
    for secret in [
        "Password: x",
        "using /p:abc",
        "[WARN] passwd changed",
        "Credentials for admin",
        "client secret ok",
    ] {
        assert_eq!(filter_log_line(secret), None, "{secret}");
    }
    let long = "x".repeat(MAX_LOG_LINE + 50);
    assert_eq!(
        filter_log_line(&long).map(|l| l.chars().count()),
        Some(MAX_LOG_LINE)
    );
}

#[tokio::test]
async fn the_arguments_go_on_stdin_and_only_args_from_stdin_on_the_command_line() {
    let dir = tempfile::tempdir().unwrap();
    let client = fake_client(dir.path(), "", 7);
    let args = build_args(&endpoint(), &RdpSettings::default(), &admin()).unwrap();

    let child = launch(&client, &args).await.unwrap();
    let recorder = Recorder::default();
    let ended = watch(child, CancellationToken::new(), &recorder).await;

    assert_eq!(ended, (CloseReason::ProcessExited, Some(7)));
    let argv = std::fs::read_to_string(dir.path().join("argv")).unwrap();
    assert_eq!(
        argv, "/args-from:stdin\n",
        "S4: nothing else on the command line"
    );
    let stdin = std::fs::read_to_string(dir.path().join("stdin")).unwrap();
    assert_eq!(stdin, *args.stdin_text());
    assert!(stdin.contains("/p:s3cret\n"));

    let mut logs = recorder.logs();
    logs.sort();
    assert_eq!(
        logs,
        [
            "[ERROR] bitmap cache full",
            "[INFO] connected to the server"
        ],
        "stdout and stderr both pass, the password line does not"
    );
}

#[tokio::test]
async fn closing_the_tab_kills_the_client() {
    let dir = tempfile::tempdir().unwrap();
    let client = fake_client(dir.path(), "sleep 30", 0);
    let args = build_args(
        &endpoint(),
        &RdpSettings::default(),
        &RdpCredentials::default(),
    )
    .unwrap();
    let child = launch(&client, &args).await.unwrap();

    let cancel = CancellationToken::new();
    let later = cancel.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(300)).await;
        later.cancel();
    });
    let started = Instant::now();
    let ended = watch(child, cancel, &Recorder::default()).await;
    assert_eq!(ended, (CloseReason::UserClosed, None));
    assert!(
        started.elapsed() < Duration::from_secs(5),
        "{:?}",
        started.elapsed()
    );
}

#[tokio::test]
async fn a_missing_client_is_an_rdp_error() {
    let args = build_args(
        &endpoint(),
        &RdpSettings::default(),
        &RdpCredentials::default(),
    )
    .unwrap();
    let error = launch(Path::new("/nonexistent/sdl-freerdp3"), &args)
        .await
        .unwrap_err();
    assert_eq!(error.kind, ErrorKind::Rdp);
}

fn connection(name: &str, protocol: Protocol, jump: Option<Uuid>) -> Connection {
    Connection::from_input(
        Uuid::new_v4(),
        ConnectionInput {
            name: name.into(),
            host: format!("{name}.lan"),
            username: Some("ops".into()),
            jump_host_id: jump,
            ..ConnectionInput::template(protocol)
        },
        1_000,
    )
}

fn defaults() -> SshDefaults {
    SshDefaults {
        connect_timeout_secs: 10,
        keepalive_secs: 30,
    }
}

#[test]
fn an_rdp_connection_resolves_with_its_bastion_as_an_ssh_target() {
    let outer = connection("outer", Protocol::Ssh, None);
    let bastion = connection("bastion", Protocol::Ssh, Some(outer.id));
    let desk = connection("desk", Protocol::Rdp, Some(bastion.id));
    let store = Store {
        groups: vec![],
        connections: vec![desk.clone(), bastion.clone(), outer.clone()],
    };
    let target = resolve_rdp(desk.id, &store, &defaults(), Some("ada")).unwrap();
    assert_eq!(target.host, "desk.lan");
    assert_eq!(target.port, 3389);
    let via = target.via.expect("a bastion");
    assert_eq!(via.connection_name, "bastion");
    assert_eq!(via.jump_hosts.len(), 1, "the bastion keeps its own chain");
    assert_eq!(via.jump_hosts[0].connection_name, "outer");

    let direct = connection("direct", Protocol::Rdp, None);
    let store = Store {
        groups: vec![],
        connections: vec![direct.clone()],
    };
    assert!(
        resolve_rdp(direct.id, &store, &defaults(), None)
            .unwrap()
            .via
            .is_none()
    );
}

#[test]
fn only_an_existing_rdp_connection_resolves() {
    let ssh = connection("web", Protocol::Ssh, None);
    let store = Store {
        groups: vec![],
        connections: vec![ssh.clone()],
    };
    let error = resolve_rdp(ssh.id, &store, &defaults(), None).unwrap_err();
    assert_eq!(error.kind, ErrorKind::Validation);
    let error = resolve_rdp(Uuid::new_v4(), &store, &defaults(), None).unwrap_err();
    assert_eq!(error.kind, ErrorKind::NotFound);
}

fn context(dir: &Path) -> SshContext {
    SshContext {
        known_hosts: Arc::new(KnownHosts::new(dir.join("known_hosts"), None)),
        prompts: Arc::new(PromptBroker::new()),
        secrets: Arc::new(SecretStore::memory()),
        agent_socket: None,
    }
}

fn direct_target(username: &str) -> RdpTarget {
    RdpTarget {
        connection_id: Uuid::new_v4(),
        name: "ad-01".into(),
        host: "10.0.0.5".into(),
        port: 3389,
        username: Some(username.into()),
        settings: RdpSettings::default(),
        via: None,
    }
}

fn launch_step(state: StepState) -> SessionEvent {
    SessionEvent::Step {
        step: StepKind::Launch,
        label: "fake-freerdp".into(),
        state,
    }
}

#[tokio::test]
async fn a_direct_rdp_tab_launches_then_ends_with_the_exit_code() {
    let dir = tempfile::tempdir().unwrap();
    let client = fake_client(dir.path(), "", 0);
    let recorder = Arc::new(Recorder::default());
    let run = RdpRun {
        id: Uuid::new_v4(),
        target: direct_target("admin"),
        credentials: RdpCredentials {
            username: Some("admin".into()),
            password: None,
        },
        client,
        cancel: CancellationToken::new(),
    };
    let sink: Arc<dyn SessionSink> = recorder.clone();
    run_rdp_session(context(dir.path()), run, sink).await;

    let events = recorder.events();
    assert_eq!(
        events[..3],
        [
            launch_step(StepState::Started),
            launch_step(StepState::Done),
            SessionEvent::Connected
        ]
    );
    assert_eq!(
        events.last(),
        Some(&SessionEvent::Closed {
            reason: CloseReason::ProcessExited,
            exit_status: Some(0),
        })
    );
    let stdin = std::fs::read_to_string(dir.path().join("stdin")).unwrap();
    assert!(stdin.starts_with("/v:10.0.0.5:3389\n/u:admin\n"), "{stdin}");
}

#[tokio::test]
async fn refused_arguments_fail_the_launch_step_and_nothing_starts() {
    let dir = tempfile::tempdir().unwrap();
    let client = fake_client(dir.path(), "", 0);
    let recorder = Arc::new(Recorder::default());
    let run = RdpRun {
        id: Uuid::new_v4(),
        target: direct_target("admin"),
        credentials: RdpCredentials {
            username: Some("ad\nmin".into()),
            password: None,
        },
        client,
        cancel: CancellationToken::new(),
    };
    let sink: Arc<dyn SessionSink> = recorder.clone();
    run_rdp_session(context(dir.path()), run, sink).await;

    let events = recorder.events();
    assert_eq!(
        events[..2],
        [
            launch_step(StepState::Started),
            launch_step(StepState::Failed)
        ]
    );
    assert!(
        matches!(&events[2], SessionEvent::Error { error } if error.kind == ErrorKind::Validation)
    );
    assert_eq!(events.len(), 3);
    assert!(!dir.path().join("argv").exists(), "the client never ran");
}
```

### `src-tauri/src/commands/ipc_rdp_tests.rs` (remplace la version de T27 : `rdp_open` en plus)

```rust
use serde_json::json;

use super::ipc_tests::{create_connection, invoke, mock_app};

#[test]
fn rdp_detect_takes_no_argument() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());

    // Either a client is installed on this machine, or none is: the arguments were read either way.
    match invoke(&webview, "rdp_detect", json!({})) {
        Ok(client) => assert!(client["version"].as_str().unwrap().starts_with("3.")),
        Err(error) => assert_eq!(error["kind"], "rdpClientMissing"),
    }
}

#[test]
fn rdp_open_accepts_the_arguments_sent_by_ipc_ts() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());
    // An SSH connection: the arguments were read, then the connection was refused as not RDP, before any client
    // is looked for.
    let web = create_connection(&webview, "web");
    let error = invoke(
        &webview,
        "rdp_open",
        json!({
            "sessionId": "5b6f2d3e-0000-4000-8000-000000000061",
            "connectionId": web["id"],
            "onEvent": "__CHANNEL__:1"
        }),
    )
    .unwrap_err();
    assert_eq!(error["kind"], "validation", "{error}");
}
```

### `src-tauri/tests/ssh_rdp.rs` (nouveau, contre podman : `npm run test:ssh`)

```rust
//! T28 against the podman environment of T16: an RDP tab behind a bastion. FreeRDP is not needed: a fake client reads
//! its arguments on stdin, connects to the `/v:` address it got (the tunnel) and saves the first line it receives.
//! The "RDP host" is the hidden SSH server, so that first line is an SSH banner. `npm run test:ssh`.
#![cfg(feature = "test-env")]

mod support;

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use support::{TestEnv, context, respond};
use tokio_util::sync::CancellationToken;
use tunl_lib::model::RdpSettings;
use tunl_lib::prompts::PromptBroker;
use tunl_lib::rdp::args::RdpCredentials;
use tunl_lib::rdp::session::{RdpRun, RdpTarget, run_rdp_session};
use tunl_lib::secrets::{SecretKind, SecretStore, SecretValue};
use tunl_lib::sessions::{CloseReason, SessionEvent, SessionSink, StepKind, StepState};
use tunl_lib::ssh::auth::AuthPlan;
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

/// A fake FreeRDP: saves its stdin, connects to the `/v:` it was given, saves the first line it reads, exits 0.
fn fake_client(dir: &Path) -> PathBuf {
    let path = dir.join("fake-freerdp");
    let script = format!(
        "#!/bin/bash\ncat > '{d}/stdin'\nv=$(grep '^/v:' '{d}/stdin' | head -1)\nhp=${{v#/v:}}\n\
         exec 3<>/dev/tcp/${{hp%:*}}/${{hp##*:}}\nhead -1 <&3 > '{d}/banner'\nexit 0\n",
        d = dir.display()
    );
    std::fs::write(&path, script).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path
}

fn bastion(env: &TestEnv) -> SshTarget {
    SshTarget {
        connection_id: Some(Uuid::new_v4()),
        connection_name: "bastion".into(),
        host: env.host("bastion"),
        port: env.port("bastion"),
        username: env.user(),
        plan: AuthPlan::Password,
        connect_timeout: Duration::from_secs(5),
        keepalive_secs: 15,
        jump_hosts: Vec::new(),
    }
}

fn steps(events: &[SessionEvent]) -> Vec<(StepKind, StepState)> {
    events
        .iter()
        .filter_map(|e| match e {
            SessionEvent::Step { step, state, .. } => Some((*step, *state)),
            _ => None,
        })
        .collect()
}

#[tokio::test]
async fn an_rdp_tab_behind_a_bastion_reaches_its_host_through_the_tunnel() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let via = bastion(&env);
    let secrets = SecretStore::memory();
    secrets
        .set(
            via.connection_id.unwrap(),
            "bastion",
            SecretKind::Password,
            &SecretValue::new(env.password()),
        )
        .await
        .unwrap();
    let broker = Arc::new(PromptBroker::new());
    respond(&broker, vec![]);
    let ctx = context(&env, dir.path(), broker, secrets);

    let run = RdpRun {
        id: Uuid::new_v4(),
        target: RdpTarget {
            connection_id: Uuid::new_v4(),
            name: "desk".into(),
            host: env.host("hidden"),
            port: env.port("hidden"),
            username: Some("admin".into()),
            settings: RdpSettings::default(),
            via: Some(via),
        },
        credentials: RdpCredentials {
            username: Some("admin".into()),
            password: Some(SecretValue::new("rdp-secret")),
        },
        client: fake_client(dir.path()),
        cancel: CancellationToken::new(),
    };
    let recorder = Arc::new(Recorder::default());
    let sink: Arc<dyn SessionSink> = recorder.clone();
    tokio::time::timeout(Duration::from_secs(20), run_rdp_session(ctx, run, sink))
        .await
        .expect("the session ends with the client");

    let events = recorder.0.lock().unwrap().clone();
    assert_eq!(
        steps(&events),
        [
            (StepKind::Target, StepState::Started),
            (StepKind::Target, StepState::Done),
            (StepKind::HostKey, StepState::Started),
            (StepKind::HostKey, StepState::Done),
            (StepKind::Auth, StepState::Started),
            (StepKind::Auth, StepState::Done),
            (StepKind::Open, StepState::Started),
            (StepKind::Open, StepState::Done),
            (StepKind::Launch, StepState::Started),
            (StepKind::Launch, StepState::Done),
        ],
        "{events:?}"
    );
    assert!(events.contains(&SessionEvent::Connected));
    assert_eq!(
        events.last(),
        Some(&SessionEvent::Closed {
            reason: CloseReason::ProcessExited,
            exit_status: Some(0),
        })
    );

    // The client was pointed at the tunnel, not at the hidden host (which this machine cannot reach).
    let stdin = std::fs::read_to_string(dir.path().join("stdin")).unwrap();
    assert!(stdin.starts_with("/v:127.0.0.1:"), "{stdin}");
    let banner = std::fs::read_to_string(dir.path().join("banner")).unwrap();
    assert!(
        banner.starts_with("SSH-2.0-"),
        "the tunnel reached the hidden host: {banner:?}"
    );
    // The tunnel's address is in the log, for the RDP card.
    assert!(events.iter().any(|e| matches!(
        e,
        SessionEvent::Log { line } if line.starts_with("tunnel 127.0.0.1:")
    )));
}
```

### `src/lib/mock/rdp-session.test.ts` (nouveau)

```ts
// T28: the mock's RDP tabs, which the RDP card of T28b is built against.
import { beforeEach, describe, expect, test } from "vitest";
import type { SessionEvent } from "@/bindings/SessionEvent";
import { toInput } from "@/features/connections/to-input";
import { toAppError } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import { resetMockBackend } from "@/lib/ipc-mock";
import { MOCK_IDS } from "@/lib/mock/data";

beforeEach(() => {
  resetMockBackend();
});

/** Open an RDP tab and collect its events until it is connected and has logged twice. */
async function open(connectionId: string): Promise<SessionEvent[]> {
  const events: SessionEvent[] = [];
  await new Promise<void>((resolve) => {
    void ipc.rdpOpen(crypto.randomUUID(), connectionId, (event) => {
      events.push(event);
      const connected = events.findIndex((e) => e.type === "connected");
      if (connected >= 0 && events.slice(connected).filter((e) => e.type === "log").length === 2) {
        resolve();
      }
    });
  });
  return events;
}

function steps(events: SessionEvent[]) {
  return events.flatMap((e) =>
    e.type === "step" && e.state === "done" ? [`${e.step}:${e.label}`] : [],
  );
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return toAppError(error);
  }
  throw new Error("expected a rejection");
}

describe("mock rdp_open", () => {
  test("a direct connection launches the client, then logs", async () => {
    const events = await open(MOCK_IDS.ad01);
    expect(steps(events)).toEqual(["launch:sdl-freerdp3"]);
    expect(events.filter((e) => e.type === "log").at(0)).toEqual({
      type: "log",
      line: "[INFO][com.freerdp.core] connected to 10.0.0.5",
    });
  });

  test("a connection that wakes its host first", async () => {
    const events = await open(MOCK_IDS.winDesktop);
    expect(steps(events)).toEqual(["wake:win-desktop", "launch:sdl-freerdp3"]);
  });

  test("behind a bastion: the bastion's steps, the tunnel, its address in the log", async () => {
    const { connections } = await ipc.storeLoad();
    const ad01 = connections.find((c) => c.id === MOCK_IDS.ad01);
    if (!ad01) throw new Error("ad-01 is in the demo data");
    await ipc.connectionUpdate(ad01.id, { ...toInput(ad01), jumpHostId: MOCK_IDS.bastion01 });
    const events = await open(MOCK_IDS.ad01);
    expect(steps(events)).toEqual([
      "target:bastion.example.net:2222",
      "hostKey:bastion.example.net",
      "auth:ops",
      "open:tunnel",
      "launch:sdl-freerdp3",
    ]);
    expect(events).toContainEqual({ type: "log", line: "tunnel 127.0.0.1:40123 → 10.0.0.5:3389" });
  });

  test("refusals come back at once", async () => {
    expect((await rejection(ipc.rdpOpen(crypto.randomUUID(), MOCK_IDS.nas, () => {}))).kind).toBe(
      "validation",
    );
    const settings = await ipc.settingsGet();
    await ipc.settingsUpdate({
      ...settings,
      rdp: { ...settings.rdp, clientPath: "/usr/bin/rdesktop" },
    });
    expect((await rejection(ipc.rdpOpen(crypto.randomUUID(), MOCK_IDS.ad01, () => {}))).kind).toBe(
      "rdpClientMissing",
    );
  });
});
```

## Étapes

1. Les tests : `node scripts/contract-tests.mjs T28`.
2. `rdp/launch.rs`, `rdp/mod.rs` : `cd src-tauri && cargo test --lib rdp::launch_tests::log`, puis les tests de
   `launch` et `watch`.
3. `rdp/session.rs` : `cargo test --lib rdp::`, puis `npm run test:ssh` (`ssh_rdp` compris).
4. `commands/sftp.rs` (`EventSink` en `pub(crate)`), `commands/rdp.rs` (`rdp_open`), `lib.rs` :
   `cargo test --lib commands::ipc_rdp`, `cargo clippy --all-targets --all-features -- -D warnings`.
5. `ipc.ts`, `lib/mock/rdp.ts` (`mockDetect`), `lib/mock/rdp-session.ts`, `ipc-mock.ts` : `npx vitest run src/lib`.
6. `npm run format`, `npm run review`, cases, statut, commit
   `feat: launch FreeRDP through stdin, follow it, tunnel through the bastion (T28)`.

## Critères d'acceptation

- [x] `npm run review` passe (avec `test:ssh`), et `node scripts/contract-tests.mjs T28 --check` affiche `OK`
      partout.
- [x] `grep -n '\.arg(' src-tauri/src/rdp/launch.rs` ne montre que `.arg("/args-from:stdin")` (S4).
- [x] `grep -rn "struct EventSink" src-tauri/src` ne trouve qu'une définition.
- [x] Aucune nouvelle exception `project-rules: allow`.

## À regarder par Florian

Rien à l'écran encore (la carte RDP arrive avec T28b). Si FreeRDP 3 est installé chez toi, T28b te le fera essayer.
