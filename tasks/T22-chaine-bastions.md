# T22 — Chaîne de bastions : résolution, `direct-tcpip`, une étape par bastion

| | |
|---|---|
| **Jalon** | M3 — Bastions et tunnels |
| **Dépend de** | T21b |
| **Lire avant** | `docs/01-architecture.md` §5, `docs/06-securite.md` S6, S7 et S8 |
| **Livrable** | `ssh/chain.rs` (nouveau), `ssh/session.rs` et `ssh/connect.rs` révisés, `MAX_JUMP_HOSTS` exporté ; mock, modèle de session, liste des étapes et barre d'état qui suivent toute la chaîne ; 6 fichiers de tests (dont 2 remplacent ceux de T19) |

## Pourquoi

Une connexion dont `jumpHostId` est rempli est aujourd'hui refusée (« jump hosts are not supported yet »). Cette
fiche la fait passer par ses bastions : TunL ouvre le premier bastion en TCP, s'y authentifie, lui demande un canal
`direct-tcpip` vers le bastion suivant, et ainsi de suite jusqu'à la cible. Chaque bastion vérifie sa propre clé
d'hôte et utilise sa propre authentification (ses secrets, son utilisateur, sa méthode).

Tout a été prototypé par l'orchestrateur contre les conteneurs de T16 : les tests de cette fiche passent, y compris
une chaîne de **deux** bastions (`target` → `tunl-test-bastion` → `hidden`).

## À réutiliser (ne pas réécrire)

- T17b : `connect::{tcp_connect, handshake, client_config_for}` (`handshake` accepte déjà n'importe quel flux).
- T18 : `auth::{authenticate, plan_for, AuthTarget}`.
- T19 : `session::{resolve_target, run_ssh_session, connect_step, username_of, connect_timeout}`.
- T06 : la constante `MAX_JUMP_HOSTS` de `model/validate.rs` (à rendre publique, ne pas la recopier).
- russh : `Handle::channel_open_direct_tcpip(host, port as u32, "127.0.0.1", 0)` puis `Channel::into_stream()`
  (un `russh::ChannelStream<Msg>`, qui implémente `AsyncRead + AsyncWrite`).
- Frontend : `jumpChainNames(connections, jumpHostId)` de `src/features/connections/jump-hosts.ts` (la chaîne côté
  utilisateur, premier bastion d'abord). Le mock et la barre d'état s'en servent : pas de deuxième parcours.

## Contrat — Rust

### `src-tauri/src/model/validate.rs` et `model/mod.rs`

`const MAX_JUMP_HOSTS` devient `pub const`, et `model/mod.rs` le réexporte :
`pub use validate::{MAX_JUMP_HOSTS, normalize_connection_input, normalize_mac};`.

### `src-tauri/src/ssh/connect.rs`

```rust
/// A stream an SSH session runs on: a TCP socket, or a `direct-tcpip` channel of the previous hop (T22).
pub trait SshStream: AsyncRead + AsyncWrite + Unpin + Send + 'static {}
impl<S: AsyncRead + AsyncWrite + Unpin + Send + 'static> SshStream for S {}
```

Elle permet de choisir le flux à l'exécution (`Box<dyn SshStream>`) : `tokio` implémente déjà `AsyncRead` et
`AsyncWrite` pour un `Box` de ce genre, et `handshake` l'accepte tel quel.

### `src-tauri/src/ssh/chain.rs` (nouveau) et `ssh/mod.rs`

`ssh/mod.rs` : `pub mod chain;` et `#[cfg(test)] mod chain_tests;`.

```rust
/// Les bastions devant `connection`, dans l'ordre où TunL les compose (le premier en TCP), sans `connection`.
pub fn resolve_chain<'a>(connection: &Connection, connections: &'a [Connection])
    -> AppResult<Vec<&'a Connection>>;

/// Ouvre `host:port` à travers le saut authentifié `via` (appelé `via_name` dans les erreurs), en `timeout` au plus.
pub async fn open_through(via: &Handle<ClientHandler>, via_name: &str, host: &str, port: u16, timeout: Duration)
    -> AppResult<ChannelStream<Msg>>;
```

`resolve_chain` part de `connection.jump_host_id` et remonte la chaîne, puis la renverse. Refus :

| Cas | Erreur |
|---|---|
| un bastion qui n'existe plus | `AppError::not_found("jump host <id>")` |
| un bastion qui n'est pas SSH | `validation("jumpHostId", …)` |
| une boucle, **y compris** un retour sur `connection` elle-même | `validation("jumpHostId", …)` |
| plus de `MAX_JUMP_HOSTS` bastions | `validation("jumpHostId", …)` |

Le store refuse déjà ces chaînes à l'enregistrement (T06), mais un fichier édité à la main ou un bastion supprimé
depuis peut encore en contenir une : on revérifie ici.

`open_through` :
- le `timeout` couvre **l'ouverture du canal seulement**, comme `tcp_connect` ne couvre que le TCP (docs/01 §5) ;
  dépassé → `ErrorKind::Timeout`, message `"<via_name> got no answer from <host>:<port> within <n> s"` ;
- refus du bastion → `ErrorKind::Network`, message exact `"<via_name> cannot reach <host>:<port>"`, et un
  `log::warn!` avec l'erreur de russh. Jamais ce que le bastion a envoyé dans le message (S7).

### `src-tauri/src/ssh/session.rs`

`SshTarget` gagne un champ :

```rust
    /// Les bastions à traverser, le premier composé en premier (T22). Vide pour une connexion directe, et
    /// toujours vide dans le `SshTarget` d'un bastion.
    pub jump_hosts: Vec<SshTarget>,
```

**`resolve_target`**, cas `Saved` :
- le refus « jump hosts are not supported yet » disparaît ;
- extraire une fonction privée `saved_target(connection, defaults, default_user) -> AppResult<SshTarget>` (le
  code actuel du cas `Saved` : protocole SSH exigé, utilisateur, plan, délais), avec `jump_hosts` vide ;
- la cible = `saved_target(connection)`, avec `jump_hosts` = `resolve_chain(…)` passé à `saved_target` maillon par
  maillon. Chaque bastion garde **ses** réglages : son utilisateur (ou l'utilisateur local), son plan
  d'authentification, son `keepalive`, son délai de connexion ;
- le cas `Quick` met `jump_hosts: Vec::new()`.

**`run_ssh_session`**, avant l'étape `Target` :

1. Pour chaque bastion, **une** étape `connect_step(StepKind::Hop, label = nom du bastion)` qui fait tout :
   le flux (TCP pour le premier, `open_through` du bastion précédent ensuite), la poignée de main (sa clé d'hôte,
   son `HostKeyTarget { host, port, session_id: Some(id) }`), puis `authenticate` avec **son** `AuthTarget`
   (son `connection_id` : c'est le mot de passe du bastion qu'on lit dans le trousseau, ou qu'on demande sous son nom).
   La poignée du bastion est gardée dans un `Vec<Handle<ClientHandler>>` jusqu'à la fin de la session.
2. `Target` : TCP s'il n'y a aucun bastion, sinon `open_through(dernier bastion, son nom, host, port, connect_timeout)`.
   Le libellé reste `host:port`.
3. `HostKey`, `Auth`, `Open`, puis le shell : inchangés.
4. À la fin du shell : `disconnect` de la cible, puis des bastions **du plus proche au premier**.

Un bastion qui échoue émet `Hop … Failed`, puis `Error`, et rien d'autre : la cible n'est jamais tentée.
L'annulation pendant un bastion (par exemple sur sa question de clé d'hôte) suit le chemin de `connect_step` :
`Closed { UserClosed }`.

Pour garder `run_ssh_session` lisible, le prototype a utilisé quatre fonctions privées : `dial(previous, to)`
(le flux, TCP ou canal → `Box<dyn SshStream>`), `handshake_with(stream, to, id, ctx)`, `connect_hop(hop, previous,
id, ctx)` et `auth_target_of(to, id)`. Rien ne t'oblige à les nommer ainsi, mais `session.rs` doit rester sous
400 lignes (le prototype : 395 ; sinon, déplace `dial` et `connect_hop` dans `chain.rs`).

## Contrat — Frontend

### `src/features/sessions/session-model.ts`

Dans `applySessionEvent`, une étape remplace la ligne **de même type et de même libellé** (aujourd'hui : de même
type). Deux bastions donnent deux lignes `hop`. Mettre à jour le commentaire de la fonction.

### `src/features/sessions/SessionView.tsx`

La liste des étapes utilise `key={step.step}` : deux lignes `hop` auraient la même clé (avertissement React, et
l'e2e échoue sur la console). Clé : `` `${step.step}:${step.label}` ``.

### `src/lib/mock/sessions.ts`

`ResolvedTarget.bastionName?: string` devient `bastions: string[]` : `jumpChainNames(state.connections,
connection.jumpHostId)` pour une connexion enregistrée qui a un bastion, `[]` sinon (et pour une cible rapide).
`runSession` émet une paire `hop started` / `hop done` par bastion, dans cet ordre. Retirer les commentaires « the
mock anticipates T22 » et « The real backend still refuses it ».

### `src/features/shell/StatusBar.tsx`

La fonction `bastionName` devient `bastionChain` : les noms de `jumpChainNames(...)` joints par `" → "`
(`via nas → bastion-01`), ou `null`. La clé i18n `statusbar.via` ne change pas.

## Pièges (vus au prototype)

- **Le `timeout` de connexion ne couvre pas la poignée de main**, ni pour un bastion ni pour la cible : l'utilisateur
  peut mettre une minute à lire une empreinte. On ne l'applique qu'à `TcpStream::connect` et à
  `channel_open_direct_tcpip`.
- `TcpStream` et `ChannelStream<Msg>` sont deux types : un `match` qui renvoie l'un ou l'autre ne compile pas. D'où
  `Box<dyn SshStream>`.
- `channel_open_direct_tcpip` prend le port en `u32` : `u32::from(port)`.
- Les poignées des bastions doivent **vivre** jusqu'à la fin de la session : un `Handle` lâché ferme sa connexion,
  et donc le canal de la cible. Les garder dans un `Vec` déclaré avant la boucle.
- Le `HostKeyTarget` d'un bastion est **son** hôte et **son** port : une clé apprise pour un bastion ne doit jamais
  être enregistrée sous le nom de la cible (et inversement).
- Le nom d'hôte qu'on passe à `channel_open_direct_tcpip` est résolu **par le bastion** (le DNS du réseau interne) :
  ne pas le résoudre côté TunL.
- Les fichiers `ssh/session_tests.rs` et `tests/ssh_shell.rs` de T19 sont **remplacés** par ceux de cette fiche
  (`contract-tests.mjs` garde la version la plus récente). `ssh_shell.rs` ne change que par `jump_hosts: Vec::new()`.

## Tests du contrat

### `src-tauri/src/ssh/chain_tests.rs` (nouveau)

```rust
use uuid::Uuid;

use super::chain::resolve_chain;
use crate::error::{AppError, ErrorKind};
use crate::model::{Connection, ConnectionInput, MAX_JUMP_HOSTS, Protocol};

fn connection(name: &str, protocol: Protocol, jump: Option<Uuid>) -> Connection {
    Connection::from_input(
        Uuid::new_v4(),
        ConnectionInput {
            name: name.into(),
            host: format!("{name}.lan"),
            jump_host_id: jump,
            ..ConnectionInput::template(protocol)
        },
        1_000,
    )
}

fn ssh(name: &str, jump: Option<Uuid>) -> Connection {
    connection(name, Protocol::Ssh, jump)
}

fn names(hops: &[&Connection]) -> Vec<String> {
    hops.iter().map(|c| c.name.clone()).collect()
}

/// A validation error's message starts with its field: `jumpHostId: …`.
fn field(error: &AppError) -> Option<&str> {
    error.message.split(':').next()
}

#[test]
fn a_direct_connection_has_an_empty_chain() {
    let web = ssh("web", None);
    let all = vec![web.clone()];
    assert!(resolve_chain(&web, &all).unwrap().is_empty());
}

#[test]
fn the_chain_is_in_dialling_order() {
    let a = ssh("a", None);
    let b = ssh("b", Some(a.id));
    let c = ssh("c", Some(b.id));
    let web = ssh("web", Some(c.id));
    // Order in the store does not matter.
    let all = vec![web.clone(), b.clone(), c.clone(), a.clone()];
    assert_eq!(names(&resolve_chain(&web, &all).unwrap()), ["a", "b", "c"]);
}

#[test]
fn four_bastions_pass_five_are_refused() {
    let mut all: Vec<Connection> = Vec::new();
    let mut previous: Option<Uuid> = None;
    for i in 0..=MAX_JUMP_HOSTS {
        let hop = ssh(&format!("hop{i}"), previous);
        previous = Some(hop.id);
        all.push(hop);
    }
    // all[4] goes through hop0..hop3: four bastions.
    assert_eq!(resolve_chain(&all[4], &all).unwrap().len(), MAX_JUMP_HOSTS);

    let web = ssh("web", previous);
    all.push(web.clone());
    let error = resolve_chain(&web, &all).unwrap_err();
    assert_eq!(error.kind, ErrorKind::Validation);
    assert_eq!(field(&error), Some("jumpHostId"));
}

#[test]
fn a_loop_is_refused_even_through_the_target() {
    // a → b → a: the store refuses it when saving, a hand-edited file may still hold it.
    let mut a = ssh("a", None);
    let b = ssh("b", Some(a.id));
    a.jump_host_id = Some(b.id);
    let all = vec![a.clone(), b.clone()];
    let error = resolve_chain(&a, &all).unwrap_err();
    assert_eq!(error.kind, ErrorKind::Validation);
    assert_eq!(field(&error), Some("jumpHostId"));

    // A connection that is its own bastion.
    let mut me = ssh("me", None);
    me.jump_host_id = Some(me.id);
    let error = resolve_chain(&me, std::slice::from_ref(&me)).unwrap_err();
    assert_eq!(error.kind, ErrorKind::Validation);
}

#[test]
fn a_loop_further_up_the_chain_is_refused_too() {
    // web → a → b → a
    let mut a = ssh("a", None);
    let b = ssh("b", Some(a.id));
    a.jump_host_id = Some(b.id);
    let web = ssh("web", Some(a.id));
    let all = vec![web.clone(), a, b];
    assert_eq!(
        resolve_chain(&web, &all).unwrap_err().kind,
        ErrorKind::Validation
    );
}

#[test]
fn an_rdp_bastion_is_refused() {
    let rdp = connection("desk", Protocol::Rdp, None);
    let web = ssh("web", Some(rdp.id));
    let all = vec![web.clone(), rdp];
    let error = resolve_chain(&web, &all).unwrap_err();
    assert_eq!(error.kind, ErrorKind::Validation);
    assert_eq!(field(&error), Some("jumpHostId"));
}

#[test]
fn a_missing_bastion_is_not_found() {
    let web = ssh("web", Some(Uuid::new_v4()));
    let all = vec![web.clone()];
    assert_eq!(
        resolve_chain(&web, &all).unwrap_err().kind,
        ErrorKind::NotFound
    );
}
```

### `src-tauri/src/ssh/session_tests.rs` (remplace la version de T19)

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
fn bastions_are_resolved_first_dialled_first_each_with_its_own_settings() {
    // web-01 → inner → outer: TunL dials outer by TCP, then inner through it, then web-01.
    let outer = ssh(
        "outer",
        None,
        SshSettings {
            auth: SshAuth::Agent,
            keepalive_secs: Some(7),
            connect_timeout_secs: Some(3),
        },
    );
    let mut inner = ssh("inner", Some("ops"), SshSettings::default());
    inner.jump_host_id = Some(outer.id);
    let mut web = ssh("web-01", Some("deploy"), SshSettings::default());
    web.jump_host_id = Some(inner.id);
    let target = SessionTarget::Saved {
        connection_id: web.id,
    };
    let resolved = resolve_target(
        &target,
        &store(vec![web.clone(), inner.clone(), outer.clone()]),
        &defaults(),
        Some("ada"),
    )
    .unwrap();

    assert_eq!(resolved.connection_id, Some(web.id));
    assert_eq!(resolved.username, "deploy");
    let names: Vec<&str> = resolved
        .jump_hosts
        .iter()
        .map(|hop| hop.connection_name.as_str())
        .collect();
    assert_eq!(names, ["outer", "inner"]);

    let first = &resolved.jump_hosts[0];
    assert_eq!(first.connection_id, Some(outer.id));
    assert_eq!(
        first.username, "ada",
        "a bastion without a user takes the local one"
    );
    assert_eq!(first.plan, AuthPlan::Agent);
    assert_eq!(first.keepalive_secs, 7);
    assert_eq!(first.connect_timeout, Duration::from_secs(3));
    assert!(first.jump_hosts.is_empty());
    assert_eq!(resolved.jump_hosts[1].username, "ops");
}

#[test]
fn a_direct_connection_has_no_bastion() {
    let web = ssh("web-01", Some("deploy"), SshSettings::default());
    let target = SessionTarget::Saved {
        connection_id: web.id,
    };
    let resolved = resolve_target(&target, &store(vec![web]), &defaults(), Some("ada")).unwrap();
    assert!(resolved.jump_hosts.is_empty());
}

#[test]
fn a_bastion_deleted_since_is_not_found() {
    let mut web = ssh("web-01", Some("deploy"), SshSettings::default());
    web.jump_host_id = Some(Uuid::new_v4());
    let target = SessionTarget::Saved {
        connection_id: web.id,
    };
    let error = resolve_target(&target, &store(vec![web]), &defaults(), Some("ada")).unwrap_err();
    assert_eq!(error.kind, ErrorKind::NotFound);
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

### `src-tauri/tests/ssh_shell.rs` (remplace la version de T19 : `jump_hosts` en plus)

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
        jump_hosts: Vec::new(),
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

### `src-tauri/tests/ssh_chain.rs` (nouveau, contre podman : `npm run test:ssh`)

```rust
//! T22 against the podman environment of T16: a shell on the hidden host, reached through one or two bastions.
//! `npm run test:ssh`. The hidden host is on the internal network only: TCP from here cannot reach it.
#![cfg(feature = "test-env")]

mod support;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use support::{TestEnv, context, respond};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use tunl_lib::error::ErrorKind;
use tunl_lib::prompts::{PromptAnswer, PromptBroker, PromptKind};
use tunl_lib::secrets::{SecretKind, SecretStore, SecretValue};
use tunl_lib::sessions::{CloseReason, SessionEvent, SessionSink, ShellInput, StepKind, StepState};
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
    /// Waits (15 s at most) until `done` holds.
    async fn wait_for(&self, what: &str, done: impl Fn(&Recorder) -> bool) {
        for _ in 0..750 {
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

/// A password-authenticated SSH target, with no bastion of its own.
fn host(name: &str, address: &str, port: u16, env: &TestEnv) -> SshTarget {
    SshTarget {
        connection_id: Some(Uuid::new_v4()),
        connection_name: name.into(),
        host: address.into(),
        port,
        username: env.user(),
        plan: AuthPlan::Password,
        connect_timeout: Duration::from_secs(5),
        keepalive_secs: 15,
        jump_hosts: Vec::new(),
    }
}

fn bastion(env: &TestEnv) -> SshTarget {
    host("bastion", &env.host("bastion"), env.port("bastion"), env)
}

fn hidden(env: &TestEnv, jump_hosts: Vec<SshTarget>) -> SshTarget {
    SshTarget {
        jump_hosts,
        ..host("hidden", &env.host("hidden"), env.port("hidden"), env)
    }
}

/// The password of every password-authenticated hop of `target`, in an in-memory keyring.
async fn secrets_for(env: &TestEnv, target: &SshTarget) -> SecretStore {
    let secrets = SecretStore::memory();
    for hop in target.jump_hosts.iter().chain(std::iter::once(target)) {
        if hop.plan == AuthPlan::Password {
            secrets
                .set(
                    hop.connection_id.unwrap(),
                    &hop.connection_name,
                    SecretKind::Password,
                    &SecretValue::new(env.password()),
                )
                .await
                .unwrap();
        }
    }
    secrets
}

struct Running {
    recorder: Arc<Recorder>,
    input: mpsc::UnboundedSender<ShellInput>,
    task: tokio::task::JoinHandle<()>,
}

fn start(ctx: tunl_lib::ssh::SshContext, target: SshTarget) -> Running {
    let recorder = Arc::new(Recorder::default());
    let (input, receiver) = mpsc::unbounded_channel();
    let session = ShellSession {
        id: Uuid::new_v4(),
        target,
        cols: 80,
        rows: 24,
        input: receiver,
        cancel: CancellationToken::new(),
    };
    let sink: Arc<dyn SessionSink> = recorder.clone();
    let task = tokio::spawn(run_ssh_session(ctx, session, sink));
    Running {
        recorder,
        input,
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

fn has_error(r: &Recorder) -> bool {
    r.events()
        .iter()
        .any(|e| matches!(e, SessionEvent::Error { .. }))
}

/// Runs `hostname` in the shell, then `exit 3`, and checks the session ends with that status.
async fn hostname_then_exit(run: Running, expected: &str) {
    run.input
        .send(ShellInput::Data(b"echo host=$(hostname)\n".to_vec()))
        .unwrap();
    let marker = format!("host={expected}");
    run.recorder
        .wait_for("the hostname", |r| r.text().contains(&marker))
        .await;
    run.input
        .send(ShellInput::Data(b"exit 3\n".to_vec()))
        .unwrap();
    tokio::time::timeout(Duration::from_secs(10), run.task)
        .await
        .expect("the session ends with the shell")
        .unwrap();
    assert_eq!(
        run.recorder.events().last(),
        Some(&SessionEvent::Closed {
            reason: CloseReason::RemoteClosed,
            exit_status: Some(3),
        })
    );
}

#[tokio::test]
async fn the_hidden_host_through_one_bastion() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let target = hidden(&env, vec![bastion(&env)]);
    let broker = Arc::new(PromptBroker::new());
    let asked = respond(&broker, vec![]);
    let ctx = context(&env, dir.path(), broker, secrets_for(&env, &target).await);

    let run = start(ctx, target);
    run.recorder.wait_for("Connected", is_connected).await;

    let address = format!("{}:{}", env.host("hidden"), env.port("hidden"));
    assert_eq!(
        run.recorder.events(),
        vec![
            step(StepKind::Hop, "bastion", StepState::Started),
            step(StepKind::Hop, "bastion", StepState::Done),
            step(StepKind::Target, &address, StepState::Started),
            step(StepKind::Target, &address, StepState::Done),
            step(StepKind::HostKey, &env.host("hidden"), StepState::Started),
            step(StepKind::HostKey, &env.host("hidden"), StepState::Done),
            step(StepKind::Auth, &env.user(), StepState::Started),
            step(StepKind::Auth, &env.user(), StepState::Done),
            step(StepKind::Open, "shell", StepState::Started),
            step(StepKind::Open, "shell", StepState::Done),
            SessionEvent::Connected,
        ]
    );
    // Every key is known and every password is in the keyring: nothing was asked.
    assert!(asked.lock().unwrap().is_empty());
    hostname_then_exit(run, "hidden").await;
}

#[tokio::test]
async fn two_bastions_each_with_its_own_host_key_and_authentication() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    // The target container, then the bastion by its name on the podman network, then the hidden host.
    let first = SshTarget {
        plan: AuthPlan::Key {
            path: env.key("ed25519"),
        },
        ..host("front", &env.host("target"), env.port("target"), &env)
    };
    let second = host("inner", "tunl-test-bastion", 22, &env);
    let target = hidden(&env, vec![first, second]);
    let broker = Arc::new(PromptBroker::new());
    // `tunl-test-bastion:22` is in no known_hosts file: its key is asked about, once.
    let asked = respond(&broker, vec![PromptAnswer::Accept]);
    let ctx = context(&env, dir.path(), broker, secrets_for(&env, &target).await);

    let run = start(ctx, target);
    run.recorder.wait_for("Connected", is_connected).await;

    let hops: Vec<SessionEvent> = run.recorder.events().into_iter().take(4).collect();
    assert_eq!(
        hops,
        vec![
            step(StepKind::Hop, "front", StepState::Started),
            step(StepKind::Hop, "front", StepState::Done),
            step(StepKind::Hop, "inner", StepState::Started),
            step(StepKind::Hop, "inner", StepState::Done),
        ]
    );
    let asked = asked.lock().unwrap().clone();
    assert_eq!(asked.len(), 1, "{asked:?}");
    match &asked[0].prompt {
        PromptKind::HostKeyUnknown { host, port, .. } => {
            assert_eq!(host, "tunl-test-bastion");
            assert_eq!(*port, 22);
        }
        other => panic!("expected the inner bastion's host key, got {other:?}"),
    }
    hostname_then_exit(run, "hidden").await;
}

#[tokio::test]
async fn a_bastion_that_cannot_reach_the_target_names_both_ends() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let target = SshTarget {
        jump_hosts: vec![bastion(&env)],
        ..host("nowhere", "nowhere.invalid", 22, &env)
    };
    let broker = Arc::new(PromptBroker::new());
    respond(&broker, vec![]);
    let ctx = context(&env, dir.path(), broker, secrets_for(&env, &target).await);

    let run = start(ctx, target);
    run.recorder.wait_for("the error", has_error).await;
    tokio::time::timeout(Duration::from_secs(10), run.task)
        .await
        .expect("a failed attempt ends")
        .unwrap();

    let events = run.recorder.events();
    assert_eq!(
        events[..4],
        [
            step(StepKind::Hop, "bastion", StepState::Started),
            step(StepKind::Hop, "bastion", StepState::Done),
            step(StepKind::Target, "nowhere.invalid:22", StepState::Started),
            step(StepKind::Target, "nowhere.invalid:22", StepState::Failed),
        ]
    );
    let Some(SessionEvent::Error { error }) = events.get(4) else {
        panic!("expected an error after the failed step: {events:?}");
    };
    assert_eq!(error.kind, ErrorKind::Network);
    assert!(error.message.contains("bastion"), "{}", error.message);
    assert!(
        error.message.contains("nowhere.invalid:22"),
        "{}",
        error.message
    );
    assert_eq!(events.len(), 5, "nothing after the error: {events:?}");
}

#[tokio::test]
async fn a_bastion_that_refuses_the_user_stops_before_the_target() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let target = hidden(&env, vec![bastion(&env)]);
    // No password in the keyring, and every prompt is cancelled.
    let broker = Arc::new(PromptBroker::new());
    let asked = respond(&broker, vec![]);
    let ctx = context(&env, dir.path(), broker, SecretStore::memory());

    let run = start(ctx, target);
    run.recorder.wait_for("the error", has_error).await;
    tokio::time::timeout(Duration::from_secs(10), run.task)
        .await
        .expect("a failed attempt ends")
        .unwrap();

    let events = run.recorder.events();
    assert_eq!(
        events[..2],
        [
            step(StepKind::Hop, "bastion", StepState::Started),
            step(StepKind::Hop, "bastion", StepState::Failed),
        ]
    );
    assert!(matches!(events.get(2), Some(SessionEvent::Error { .. })));
    assert_eq!(events.len(), 3, "the target is never tried: {events:?}");
    // The password asked for is the bastion's, under its own name.
    let asked = asked.lock().unwrap().clone();
    assert!(
        matches!(&asked[0].prompt, PromptKind::Password { connection_name, .. } if connection_name == "bastion"),
        "{asked:?}"
    );
}
```

### `src/features/sessions/session-hops.test.ts` (nouveau)

```ts
// T22: a session through several bastions keeps one step line per bastion.
import { describe, expect, test } from "vitest";
import type { SessionEvent } from "@/bindings/SessionEvent";
import { applySessionEvent, newSession, type Session } from "./session-model";

function fold(events: SessionEvent[]): Session {
  const start = newSession("tab-1", "web-01", {
    type: "saved",
    connectionId: "00000000-0000-4000-8000-000000000001",
  });
  return events.reduce(applySessionEvent, start);
}

describe("hop steps", () => {
  test("each bastion has its own line, in the order they started", () => {
    const session = fold([
      { type: "step", step: "hop", label: "outer", state: "started" },
      { type: "step", step: "hop", label: "outer", state: "done" },
      { type: "step", step: "hop", label: "inner", state: "started" },
    ]);
    expect(session.steps).toEqual([
      { step: "hop", label: "outer", state: "done" },
      { step: "hop", label: "inner", state: "started" },
    ]);
  });

  test("a failed bastion marks its own line only", () => {
    const session = fold([
      { type: "step", step: "hop", label: "outer", state: "started" },
      { type: "step", step: "hop", label: "outer", state: "done" },
      { type: "step", step: "hop", label: "inner", state: "started" },
      { type: "step", step: "hop", label: "inner", state: "failed" },
      {
        type: "error",
        error: { kind: "auth", message: "authentication failed", detail: null },
      },
    ]);
    expect(session.status).toBe("error");
    expect(session.steps).toEqual([
      { step: "hop", label: "outer", state: "done" },
      { step: "hop", label: "inner", state: "failed" },
    ]);
  });

  test("the target's steps follow the bastions", () => {
    const session = fold([
      { type: "step", step: "hop", label: "outer", state: "done" },
      { type: "step", step: "target", label: "db.internal:22", state: "started" },
      { type: "step", step: "target", label: "db.internal:22", state: "done" },
    ]);
    expect(session.steps.map((s) => `${s.step}:${s.label}:${s.state}`)).toEqual([
      "hop:outer:done",
      "target:db.internal:22:done",
    ]);
  });
});
```

### `e2e/jump-chain.spec.ts` (nouveau)

```ts
// T22: a session through a chain of bastions (mock: web-01 goes through bastion-01).
import { expectSaneUi } from "./support/sanity.ts";
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

function editor(page: Page) {
  return page.getByRole("dialog");
}

function view(page: Page, title: string) {
  return page.getByRole("region", { name: title, exact: true });
}

/** bastion-01 now goes through nas: web-01 → bastion-01 → nas. */
async function chainBastionThroughNas(page: Page) {
  await page
    .getByRole("button", { name: /^bastion-01/ })
    .first()
    .click({ button: "right" });
  await page.getByRole("menu").getByText("Edit", { exact: true }).click();
  await editor(page).getByRole("tab", { name: "Network" }).click();
  await editor(page).getByRole("combobox", { name: "Jump host" }).click();
  await page.getByRole("option", { name: "nas" }).click();
  await editor(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor(page)).toHaveCount(0);
}

test("each bastion of the chain has its own line, the first dialled first", async ({ page }) => {
  await chainBastionThroughNas(page);
  await page
    .getByRole("button", { name: /^web-01/ })
    .first()
    .dblclick();

  const overlay = view(page, "web-01").getByRole("status");
  await expect(overlay).toContainText("Through nas");
  await expect(overlay).toContainText("Through bastion-01");
  const lines = await overlay.getByRole("listitem").allTextContents();
  const nas = lines.findIndex((line) => line.includes("Through nas"));
  const bastion = lines.findIndex((line) => line.includes("Through bastion-01"));
  expect(nas).toBeGreaterThanOrEqual(0);
  expect(bastion).toBe(nas + 1);
  await expectSaneUi(page);

  await expect(view(page, "web-01").locator(".xterm-rows")).toContainText("Welcome to web-01");
  await expect(page.getByRole("contentinfo")).toContainText("via nas → bastion-01");
});
```

## Étapes

1. Les tests : `node scripts/contract-tests.mjs T22`.
2. `model/validate.rs` et `model/mod.rs` (`MAX_JUMP_HOSTS`), `ssh/connect.rs` (`SshStream`), `ssh/mod.rs`, puis
   `ssh/chain.rs` : `cd src-tauri && cargo test --lib ssh::chain` jusqu'au vert.
3. `ssh/session.rs` (`jump_hosts`, `saved_target`, `resolve_target`, `run_ssh_session`) :
   `cargo test --lib ssh::session`, puis `npm run test:ssh` jusqu'au vert (les fichiers `ssh_*`, dont `ssh_chain`).
4. Frontend : `session-model.ts`, `SessionView.tsx`, `lib/mock/sessions.ts`, `StatusBar.tsx` :
   `npx vitest run src/features/sessions`, puis `npx playwright test e2e/jump-chain.spec.ts e2e/sessions.spec.ts`.
5. `npm run format`, `npm run review`, cases, statut, ligne du `README.md` (« SSH
   sessions in tabs » : retirer « no jump host yet »), commit `feat: SSH sessions through a chain of jump hosts (T22)`.

## Critères d'acceptation

- [ ] `npm run review` passe (avec `test:ssh`), et `node scripts/contract-tests.mjs T22 --check` affiche `OK`
      partout.
- [ ] `grep -rn "not supported yet\|anticipates T22" src src-tauri/src` ne trouve rien.
- [ ] `grep -rn "MAX_JUMP_HOSTS: usize = 4" src-tauri/src` ne trouve qu'une ligne.
- [ ] Aucune nouvelle exception `project-rules: allow`.
- [ ] Visuel : avec deux bastions, la carte de connexion montre une ligne « Through … » par bastion, alignées, et la
      barre d'état `via a → b` tient sur une ligne.

## À regarder par Florian

`npm run tauri dev`, une connexion **derrière un bastion** (onglet Réseau de l'éditeur) : double-clic. La carte
montre « Through <bastion> », puis les étapes de la cible. Si la clé du bastion est inconnue, la question porte sur
le bastion (son nom d'hôte), puis, si besoin, une deuxième question pour la cible.
