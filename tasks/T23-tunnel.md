# T23 — Lien SSH réutilisable (`establish`) et tunnel local vers une cible derrière la chaîne

| | |
|---|---|
| **Jalon** | M3 — Bastions et tunnels |
| **Dépend de** | T22, T29 |
| **Lire avant** | `docs/01-architecture.md` §5 et §8 (« Via bastion »), `docs/06-securite.md` S8 et S15 |
| **Livrable** | `ssh/link.rs` (`SshLink`, `establish`) extrait de `run_ssh_session` ; `ssh/forward.rs` (tunnel local) ; 1 fichier de tests contre podman |

## Pourquoi

Trois usages vont partir d'une connexion SSH **authentifiée** à travers les bastions : le shell (déjà là),
l'explorateur SFTP (T24) et le RDP via bastion (T28). Aujourd'hui, ce parcours (bastions, cible, clé d'hôte,
authentification) est écrit **dans** `run_ssh_session`. Cette fiche :
1. l'en sort, dans une fonction `establish` qui rend un `SshLink` ;
2. ajoute le **tunnel local** : un port libre de `127.0.0.1` dont chaque connexion TCP est portée par un canal
   `direct-tcpip` du lien vers `hôte:port`. FreeRDP s'y connectera en T28.

Aucun changement visible : les tests de T19 et T22 (`ssh_shell.rs`, `ssh_chain.rs`) doivent passer **sans
modification**, c'est la garantie que le parcours n'a pas bougé.

Prototypé par l'orchestrateur contre les conteneurs de T16 : les tests de cette fiche passent.

## À réutiliser (ne pas réécrire)

- T22 : dans `ssh/chain.rs`, `resolve_chain`, `open_through`, et les fonctions `pub(crate)` du parcours :
  `dial` (le flux TCP ou `direct-tcpip`), `handshake_with`, `connect_hop` (un bastion de bout en bout),
  `auth_target_of`. **On s'en sert, on ne les réécrit pas.**
- T19 / T29 : `session::connect_step` (déjà `pub(crate)` depuis T29).
- T17b : `connect::handshake`, `tcp_connect` ; T18 : `auth::authenticate`.
- `tests/support/mod.rs` : `TestEnv`, `context`, `respond`.
- tokio : `tokio::io::copy_bidirectional`, `TcpListener`.

## Contrat — Rust

### `src-tauri/src/ssh/link.rs` (nouveau ; `ssh/mod.rs` : `pub mod link;`)

```rust
/// La cible authentifiée et ses bastions, gardés vivants aussi longtemps que le lien.
pub struct SshLink {
    pub target: Handle<ClientHandler>,
    pub hops: Vec<Handle<ClientHandler>>,
}

impl SshLink {
    /// Au revoir propre : la cible d'abord, puis chaque bastion du plus proche au premier.
    pub async fn disconnect(&self);
}

/// Les étapes `Hop` (une par bastion), `Target`, `HostKey`, `Auth`, rapportées par `sink`.
/// `None` : une étape a échoué ou a été annulée, et ses événements sont déjà partis : l'appelant s'arrête.
pub async fn establish(
    ctx: &SshContext,
    target: &SshTarget,
    session_id: Uuid,
    cancel: CancellationToken,
    sink: &dyn SessionSink,
) -> Option<SshLink>;
```

- `establish` contient **exactement** ce que `run_ssh_session` faisait avant l'étape `Open` : mêmes étapes, mêmes
  libellés, même ordre, même gestion de l'annulation (par `connect_step`).
- `run_ssh_session` devient : `establish(…)` (s'arrête sur `None`), puis l'étape `Open` « shell » sur
  `link.target`, `Connected`, `pump`, `Closed`, puis `link.disconnect().await`.
- `establish` reprend la boucle des bastions et les étapes de la cible de `run_ssh_session`, avec les fonctions de
  `chain.rs` et `connect_step` (`pub(crate)` depuis T29). Après la fiche, `session.rs` ne contient plus aucune
  boucle sur `jump_hosts` ; s'il reste une petite fonction privée qui ne sert qu'au parcours (le nom du bastion
  précédent, par exemple), elle déménage dans `link.rs`.
- `Option` plutôt que `Result<_, ()>` : clippy (`result_unit_err`) refuse un `Result<_, ()>` dans une fonction
  publique.

### `src-tauri/src/ssh/forward.rs` (nouveau ; `ssh/mod.rs` : `pub mod forward;`)

```rust
/// Un port libre de l'interface de bouclage seulement : rien hors de cette machine ne peut l'atteindre.
pub async fn bind_local() -> AppResult<TcpListener>;

/// Porte chaque connexion acceptée sur `listener` vers `host:port` à travers `via`, jusqu'à `cancel`.
pub async fn forward(
    listener: TcpListener,
    via: &Handle<ClientHandler>,
    host: &str,
    port: u16,
    cancel: CancellationToken,
);
```

| Cas | Comportement |
|---|---|
| `bind_local` | `TcpListener::bind((Ipv4Addr::LOCALHOST, 0))` ; échec → `ErrorKind::Io`, message `"cannot open a local port for the tunnel"`, et l'erreur du système dans un `log::warn!` |
| connexion acceptée | `via.channel_open_direct_tcpip(host, port, "127.0.0.1", port_du_client)` ; ouvert → une tâche `tokio::spawn` copie dans les deux sens (`copy_bidirectional`) jusqu'à la fermeture d'un des bouts **ou** `cancel` |
| canal refusé (le bastion ne joint pas la cible) | `log::warn!` qui nomme `host:port`, la connexion locale est fermée **aussitôt** ; le tunnel continue d'écouter |
| `cancel` | `forward` rend la main ; l'écoute se ferme (le `listener` est lâché) et chaque connexion en cours se ferme aussi |
| erreur d'`accept` | ignorée, on continue |

Rien n'est journalisé du contenu qui passe (S8). Le tunnel n'écoute que sur `127.0.0.1` (S15).

## Pièges (vus au prototype)

- **Garder les bastions en vie** : `SshLink` les possède. Lâcher un `Handle` de bastion ferme le canal sur lequel
  roule la cible.
- `forward` reçoit `&Handle` : dans un test (et en T28), le lien est dans un `Arc<SshLink>` déplacé dans la tâche qui
  appelle `forward(listener, &link.target, …)`.
- Le canal `direct-tcpip` s'ouvre **avant** de lancer la copie : chaque connexion locale a son propre canal, et un
  refus ne bloque que celle-là.
- `copy_bidirectional` et `cancel.cancelled()` dans un `tokio::select!` : sans lui, une connexion restée ouverte
  survivrait à la fermeture de l'onglet.
- **`npm run test:ssh` recrée les conteneurs** avec les clés de ton clone : ne le lance jamais pendant qu'un autre
  clone l'utilise.

## Tests du contrat

### `src-tauri/tests/ssh_tunnel.rs` (nouveau, contre podman : `npm run test:ssh`)

```rust
//! T23 against the podman environment of T16: an authenticated link to the bastion, and a local tunnel through it to
//! the hidden host (which this machine cannot reach by itself). `npm run test:ssh`.
#![cfg(feature = "test-env")]

mod support;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use support::{TestEnv, context, respond};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::net::TcpStream;
use tokio_util::sync::CancellationToken;
use tunl_lib::prompts::PromptBroker;
use tunl_lib::secrets::{SecretKind, SecretStore, SecretValue};
use tunl_lib::sessions::{SessionEvent, SessionSink, StepKind, StepState};
use tunl_lib::ssh::auth::AuthPlan;
use tunl_lib::ssh::forward::{bind_local, forward};
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

/// The authenticated link to the bastion, its password in an in-memory keyring.
async fn link_to_bastion(env: &TestEnv, dir: &std::path::Path) -> Arc<SshLink> {
    let target = bastion(env);
    let secrets = SecretStore::memory();
    secrets
        .set(
            target.connection_id.unwrap(),
            "bastion",
            SecretKind::Password,
            &SecretValue::new(env.password()),
        )
        .await
        .unwrap();
    let broker = Arc::new(PromptBroker::new());
    respond(&broker, vec![]);
    let ctx = context(env, dir, broker, secrets);
    let recorder = Recorder::default();
    let link = establish(
        &ctx,
        &target,
        Uuid::new_v4(),
        CancellationToken::new(),
        &recorder,
    )
    .await
    .unwrap_or_else(|| panic!("no link: {:?}", recorder.0.lock().unwrap()));

    // The same steps as a shell session, without Open.
    let address = format!("{}:{}", env.host("bastion"), env.port("bastion"));
    let steps: Vec<(StepKind, StepState)> = recorder
        .0
        .lock()
        .unwrap()
        .iter()
        .filter_map(|e| match e {
            SessionEvent::Step { step, state, label } => {
                if *step == StepKind::Target {
                    assert_eq!(label, &address);
                }
                Some((*step, *state))
            }
            _ => None,
        })
        .collect();
    assert_eq!(
        steps,
        [
            (StepKind::Target, StepState::Started),
            (StepKind::Target, StepState::Done),
            (StepKind::HostKey, StepState::Started),
            (StepKind::HostKey, StepState::Done),
            (StepKind::Auth, StepState::Started),
            (StepKind::Auth, StepState::Done),
        ]
    );
    Arc::new(link)
}

/// Start a tunnel to `host:port` through `link`; returns its local port and the task running it.
async fn tunnel(
    link: Arc<SshLink>,
    host: &'static str,
    port: u16,
    cancel: CancellationToken,
) -> (u16, tokio::task::JoinHandle<()>) {
    let listener = bind_local().await.unwrap();
    let address = listener.local_addr().unwrap();
    assert!(address.ip().is_loopback(), "only the loopback interface");
    let task = tokio::spawn(async move {
        forward(listener, &link.target, host, port, cancel).await;
    });
    (address.port(), task)
}

/// The first line the far end sends: an SSH server greets with `SSH-2.0-…`.
async fn greeting(port: u16) -> String {
    let stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    let mut line = String::new();
    tokio::time::timeout(
        Duration::from_secs(5),
        BufReader::new(stream).read_line(&mut line),
    )
    .await
    .expect("a greeting through the tunnel")
    .unwrap();
    line
}

#[tokio::test]
async fn the_tunnel_reaches_the_hidden_host_through_the_bastion() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let link = link_to_bastion(&env, dir.path()).await;
    let (port, _task) = tunnel(link.clone(), "hidden", 22, CancellationToken::new()).await;

    // Two connections, at the same time, each with its own channel.
    let (first, second) = tokio::join!(greeting(port), greeting(port));
    assert!(first.starts_with("SSH-2.0-"), "{first:?}");
    assert!(second.starts_with("SSH-2.0-"), "{second:?}");
    link.disconnect().await;
}

#[tokio::test]
async fn a_host_the_bastion_cannot_reach_closes_that_connection_only() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let link = link_to_bastion(&env, dir.path()).await;
    let (port, task) = tunnel(
        link.clone(),
        "nowhere.invalid",
        22,
        CancellationToken::new(),
    )
    .await;

    for _ in 0..2 {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        let mut buffer = [0u8; 16];
        let read = tokio::time::timeout(Duration::from_secs(5), stream.read(&mut buffer))
            .await
            .expect("the connection is closed, not left hanging");
        assert!(matches!(read, Ok(0) | Err(_)), "{read:?}");
    }
    assert!(!task.is_finished(), "the tunnel keeps listening");
    link.disconnect().await;
}

#[tokio::test]
async fn cancelling_closes_the_port_and_the_open_connections() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let link = link_to_bastion(&env, dir.path()).await;
    let cancel = CancellationToken::new();
    let (port, task) = tunnel(link.clone(), "hidden", 22, cancel.clone()).await;

    let stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    reader.read_line(&mut line).await.unwrap();
    assert!(line.starts_with("SSH-2.0-"));

    cancel.cancel();
    tokio::time::timeout(Duration::from_secs(5), task)
        .await
        .expect("the tunnel stops")
        .unwrap();

    // The open connection ends too (EOF or reset): reading it does not hang.
    let mut rest = Vec::new();
    let _ = tokio::time::timeout(Duration::from_secs(5), reader.read_to_end(&mut rest))
        .await
        .expect("the open connection is closed too");
    assert!(
        TcpStream::connect(("127.0.0.1", port)).await.is_err(),
        "nothing listens any more"
    );
    link.disconnect().await;
}
```

## Étapes

1. Les tests : `node scripts/contract-tests.mjs T23`.
2. `ssh/link.rs` (`SshLink`, `establish`), puis `run_ssh_session` qui s'en sert ; déplacements vers `chain.rs` si
   besoin : `cd src-tauri && cargo test --lib`, puis `npm run test:ssh` (`ssh_shell` et `ssh_chain` **inchangés**,
   au vert).
3. `ssh/forward.rs` : `npm run test:ssh` jusqu'au vert (`ssh_tunnel` compris).
4. `npm run format`, `npm run review`, cases, statut, commit
   `feat: reusable SSH link and local tunnel through the jump chain (T23)`.

## Critères d'acceptation

- [ ] `npm run review` passe (avec `test:ssh`), et `node scripts/contract-tests.mjs T23 --check` affiche `OK`
      partout.
- [ ] `git diff main -- src-tauri/tests/ssh_shell.rs src-tauri/tests/ssh_chain.rs` est vide.
- [ ] `grep -n "jump_hosts" src-tauri/src/ssh/session.rs` ne montre plus de boucle (seulement la résolution dans
      `resolve_target`).
- [ ] `grep -rn "0.0.0.0\|UNSPECIFIED" src-tauri/src/ssh/forward.rs` ne trouve rien.
- [ ] Aucune nouvelle exception `project-rules: allow`.

## À regarder par Florian

Rien à l'écran : le tunnel servira au RDP via bastion (T28). Une session SSH (avec ou sans bastion) doit marcher
exactement comme avant.
