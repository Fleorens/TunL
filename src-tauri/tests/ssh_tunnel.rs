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
