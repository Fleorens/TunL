//! T50 against the podman target: keystrokes typed while the shell is paused hold up neither the ack that
//! resumes it nor the close of the tab. Past 10 of them, russh's own queue is full while its session loop
//! waits for room in the paused channel. `npm run test:ssh`.
#![cfg(feature = "test-env")]

mod support;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use support::{TestEnv, context, respond};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use tunl_lib::prompts::PromptBroker;
use tunl_lib::secrets::{SecretKind, SecretStore, SecretValue};
use tunl_lib::sessions::{CloseReason, SessionEvent, SessionSink, ShellInput};
use tunl_lib::ssh::auth::AuthPlan;
use tunl_lib::ssh::session::{ShellSession, SshTarget, run_ssh_session};
use tunl_lib::ssh::shell::ACK_HIGH_WATER;
use uuid::Uuid;

/// Counts the output, keeps the events.
#[derive(Default)]
struct Tally {
    bytes: AtomicUsize,
    events: Mutex<Vec<SessionEvent>>,
}

impl SessionSink for Tally {
    fn event(&self, event: SessionEvent) {
        self.events.lock().unwrap().push(event);
    }
    fn output(&self, bytes: Vec<u8>) {
        self.bytes.fetch_add(bytes.len(), Ordering::SeqCst);
    }
}

impl Tally {
    fn total(&self) -> usize {
        self.bytes.load(Ordering::SeqCst)
    }

    /// The output once it stopped growing for half a second (10 s at most): the shell is paused.
    async fn paused(&self) -> usize {
        let mut last = self.total();
        for _ in 0..20 {
            tokio::time::sleep(Duration::from_millis(500)).await;
            let now = self.total();
            if now == last && now > 0 {
                return now;
            }
            last = now;
        }
        panic!("the output never paused ({last} bytes)");
    }
}

/// 20 keystrokes and a resize, more than russh's queue of 10 holds while its session loop is stuck.
fn type_while_paused(input: &mpsc::UnboundedSender<ShellInput>) {
    for _ in 0..20 {
        input.send(ShellInput::Data(b"x".to_vec())).unwrap();
    }
    input
        .send(ShellInput::Resize {
            cols: 100,
            rows: 30,
        })
        .unwrap();
}

#[tokio::test]
async fn keystrokes_during_a_pause_hold_up_neither_the_ack_nor_the_close() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let id = Uuid::new_v4();
    let secrets = SecretStore::memory();
    let password = SecretValue::new(env.password());
    secrets
        .set(id, "target", SecretKind::Password, &password)
        .await
        .unwrap();
    let broker = Arc::new(PromptBroker::new());
    respond(&broker, vec![]);
    let (input, receiver) = mpsc::unbounded_channel();
    let cancel = CancellationToken::new();
    let session = ShellSession {
        id: Uuid::new_v4(),
        target: SshTarget {
            connection_id: Some(id),
            connection_name: "target".into(),
            host: env.host("target"),
            port: env.port("target"),
            username: env.user(),
            plan: AuthPlan::Password,
            connect_timeout: Duration::from_secs(5),
            keepalive_secs: 15,
            jump_hosts: Vec::new(),
        },
        cols: 80,
        rows: 24,
        input: receiver,
        cancel: cancel.clone(),
    };
    let tally = Arc::new(Tally::default());
    let sink: Arc<dyn SessionSink> = tally.clone();
    let ctx = context(&env, dir.path(), broker, secrets);
    let task = tokio::spawn(run_ssh_session(ctx, session, sink));

    input
        .send(ShellInput::Data(
            b"yes 0123456789 | head -c 40000000\n".to_vec(),
        ))
        .unwrap();
    let first = tally.paused().await;
    assert!(first >= ACK_HIGH_WATER / 2, "paused at {first} bytes");

    type_while_paused(&input);
    input.send(ShellInput::Ack(first)).unwrap();
    for _ in 0..50 {
        if tally.total() > first {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert!(tally.total() > first, "the ack resumes the output");

    tally.paused().await;
    type_while_paused(&input);
    cancel.cancel();
    tokio::time::timeout(Duration::from_secs(5), task)
        .await
        .expect("a cancel ends the paused session")
        .unwrap();
    assert_eq!(
        tally.events.lock().unwrap().last(),
        Some(&SessionEvent::Closed {
            reason: CloseReason::UserClosed,
            exit_status: None,
        })
    );
}
