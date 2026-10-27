# T49 — Connexion SSH : un délai jusqu'à la clé d'hôte, une boucle d'acceptation qui ne s'emballe pas, une copie en moins

| | |
|---|---|
| **Jalon** | M9 — Revue globale (lot 7) |
| **Dépend de** | T48 |
| **Lire avant** | `docs/01-architecture.md` § 5 (étapes d'une connexion) ; `docs/06-securite.md` S6 |
| **Livrable** | `ssh/connect.rs`, `ssh/handler.rs`, `ssh/chain.rs`, `ssh/forward.rs`, `ssh/shell.rs` ; `src-tauri/src/ssh/handshake_timeout_tests.rs`, `src-tauri/tests/ssh_handshake_timeout.rs` |

## Pourquoi

Revue globale du 2026-10-27, à la lecture du code :

1. **Poignée de main sans fin — supposé (lecture)** : le délai de connexion ne couvre que le TCP (`tcp_connect`,
   `open_through`). Ensuite `connect_stream` attend la bannière SSH sans limite (`inactivity_timeout: None`). Un port
   qui accepte la connexion mais ne parle pas SSH (une faute de frappe vers le 80, un service bloqué) laisse
   l'onglet sur « Vérification de la clé d'hôte… » pour toujours. OpenSSH applique `ConnectTimeout` à la bannière et
   à l'échange de clés aussi. Le délai ne doit **pas** couvrir le temps que l'utilisateur passe sur la question de
   la clé d'hôte (c'est pour cela qu'il a été limité au TCP).
2. **Boucle qui tourne à vide — supposé (lecture)** : dans `forward`, une erreur d'`accept` (par exemple
   « trop de fichiers ouverts ») fait `continue` sans attendre : la tâche du tunnel RDP prend alors 100 % d'un cœur.
3. **Copie en trop — lecture** : `pump` copie chaque bloc reçu (`data.to_vec()`), puis `emit_output` recopie chaque
   morceau (`chunk.to_vec()`).

## À réutiliser (ne pas réécrire)

- `handshake`, `client_config_for`, `HostKeyTarget`, `ClientHandler` (`connect.rs`, `handler.rs`) ; `handshake_with`
  (`chain.rs`) qui sert à chaque saut et à la cible.

## Contrat — Rust

- Nouvelle fonction publique dans `connect.rs` :

  ```rust
  pub async fn handshake_timed<S>(stream: S, target: HostKeyTarget, config: Arc<Config>, ctx: &SshContext,
      timeout: Duration) -> AppResult<Handle<ClientHandler>>
  where S: AsyncRead + AsyncWrite + Unpin + Send + 'static
  ```

  Comme `handshake`, mais si le serveur n'a pas présenté sa clé d'hôte (appel de `check_server_key`) dans `timeout`,
  elle échoue avec `ErrorKind::Timeout`, message `no SSH answer from {host}:{port} within {:.1} s`. Dès que
  `check_server_key` commence, le délai ne s'applique plus : la question à l'utilisateur peut durer.
- `handshake` garde sa signature et son comportement (sans délai) : les tests de T17b l'appellent.
- `handshake_with` (`chain.rs`) appelle `handshake_timed` avec le `connect_timeout` du saut ou de la cible.
- `forward` : après une erreur d'`accept`, attendre 100 ms (toujours interrompu par `cancel`) avant de réessayer.
- `pump` / `emit_output` : `emit_output(sink, &data)` découpe la tranche reçue sans la copier d'abord.

## Pièges

- `ClientHandler` est déplacé dans russh par `connect_stream` : pour savoir que la clé est arrivée, partage un signal
  (`Arc<tokio::sync::Notify>` ou `watch`) créé avant, déclenché au **début** de `check_server_key`.
- Un `tokio::time::timeout` posé autour de tout `connect_stream` serait faux : il couperait la question de la clé
  d'hôte. Il faut une course entre `connect_stream` et « délai écoulé **et** clé pas encore vue ».
- Le message d'erreur ne reprend rien de ce que le serveur a envoyé (S7).

## Tests du contrat

### `src-tauri/src/ssh/handshake_timeout_tests.rs` (nouveau)

```rust
//! T49: a server that accepts TCP but never speaks SSH fails the handshake in time, without podman.
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::net::{TcpListener, TcpStream};

use crate::error::ErrorKind;
use crate::prompts::PromptBroker;
use crate::secrets::SecretStore;
use crate::ssh::SshContext;
use crate::ssh::connect::{client_config, handshake_timed};
use crate::ssh::handler::HostKeyTarget;
use crate::ssh::known_hosts::KnownHosts;

fn context(dir: &std::path::Path) -> SshContext {
    SshContext {
        known_hosts: Arc::new(KnownHosts::new(dir.join("known_hosts"), None)),
        prompts: Arc::new(PromptBroker::new()),
        secrets: Arc::new(SecretStore::memory()),
        agent_socket: None,
    }
}

#[tokio::test]
async fn a_server_that_never_speaks_ssh_times_out() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    // Accept, then hold the socket open without ever sending a banner.
    let silent = tokio::spawn(async move {
        let (socket, _) = listener.accept().await.unwrap();
        tokio::time::sleep(Duration::from_secs(30)).await;
        drop(socket);
    });

    let dir = tempfile::tempdir().unwrap();
    let stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    let started = Instant::now();
    let result = handshake_timed(
        stream,
        HostKeyTarget {
            host: "127.0.0.1".into(),
            port,
            session_id: None,
        },
        client_config(0),
        &context(dir.path()),
        Duration::from_millis(500),
    )
    .await;

    let error = result.err().expect("the handshake must fail");
    assert_eq!(error.kind, ErrorKind::Timeout);
    assert!(
        error.message.starts_with("no SSH answer from 127.0.0.1:"),
        "{}",
        error.message
    );
    assert!(started.elapsed() < Duration::from_secs(5), "it fails in time");
    silent.abort();
}
```

### `src-tauri/tests/ssh_handshake_timeout.rs` (nouveau)

```rust
//! T49 against the podman target: the handshake delay never covers the time spent on the host key question.
//! `npm run test:ssh`.
#![cfg(feature = "test-env")]

mod support;

use std::sync::Arc;
use std::time::Duration;

use support::{TestEnv, blank_context, host_key_target};
use tunl_lib::prompts::{PromptAnswer, PromptBroker};
use tunl_lib::secrets::SecretStore;
use tunl_lib::ssh::connect::{client_config, handshake_timed, tcp_connect};

#[tokio::test]
async fn a_slow_answer_to_the_host_key_question_is_not_a_timeout() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let broker = Arc::new(PromptBroker::new());
    let weak = Arc::downgrade(&broker);
    // Answer "trust" 1.5 s after the question, three times longer than the delay below.
    broker.set_emitter(Box::new(move |request| {
        let id = request.id;
        let weak = weak.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(1500));
            if let Some(broker) = weak.upgrade() {
                broker.answer(id, PromptAnswer::Accept).unwrap();
            }
        });
    }));
    let ctx = blank_context(dir.path(), broker, SecretStore::memory());

    let stream = tcp_connect(
        &env.host("target"),
        env.port("target"),
        Duration::from_secs(5),
    )
    .await
    .unwrap();
    let handle = handshake_timed(
        stream,
        host_key_target(&env, "target"),
        client_config(15),
        &ctx,
        Duration::from_millis(500),
    )
    .await;
    assert!(handle.is_ok(), "the delay stops once the host key is shown");
}
```

## Étapes

1. Les tests : `node scripts/contract-tests.mjs T49` ; déclarer `#[cfg(test)] mod handshake_timeout_tests;` dans
   `ssh/mod.rs`.
2. `handler.rs`, `connect.rs` (`handshake_timed`), `chain.rs` : `cd src-tauri && cargo test --lib ssh`.
3. `forward.rs`, `shell.rs`, puis `npm run test:ssh` (pas pendant un job `dev`).
4. `npm run format`, `npm run review`, cases, statut, commit
   `fix: time out a silent SSH server before the host key, calmer tunnel accept loop (T49)`.

## Critères d'acceptation

- [ ] `npm run review` passe (avec `test:ssh`), et `node scripts/contract-tests.mjs T49 --check` affiche `OK` partout.
- [ ] `grep -n "to_vec()" src-tauri/src/ssh/shell.rs` ne trouve plus qu'une copie par morceau envoyé.
- [ ] Aucune nouvelle exception `project-rules: allow`.

## À regarder par Florian

`npm run tauri dev` : connexion rapide vers `ton-serveur:80` (un port web). Au bout du délai de connexion (15 s par
défaut), l'onglet passe en erreur « Délai dépassé » au lieu de tourner sans fin. Une première connexion à un serveur
inconnu : prends ton temps sur la question de la clé d'hôte, la connexion aboutit quand même.
