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
