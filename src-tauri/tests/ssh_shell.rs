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
