//! T50 against the podman target: without acks the shell stops being read at the high water mark, and an ack
//! resumes it. `npm run test:ssh`.
#![cfg(feature = "test-env")]

mod support;

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use support::{TestEnv, context, respond};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use tunl_lib::prompts::PromptBroker;
use tunl_lib::secrets::{SecretKind, SecretStore, SecretValue};
use tunl_lib::sessions::{SessionEvent, SessionSink, ShellInput};
use tunl_lib::ssh::auth::AuthPlan;
use tunl_lib::ssh::link::establish;
use tunl_lib::ssh::session::SshTarget;
use tunl_lib::ssh::shell::{ACK_HIGH_WATER, OUTPUT_CHUNK, open_shell, pump};
use uuid::Uuid;

#[derive(Default)]
struct Counter(AtomicUsize);

impl SessionSink for Counter {
    fn event(&self, _event: SessionEvent) {}
    fn output(&self, bytes: Vec<u8>) {
        self.0.fetch_add(bytes.len(), Ordering::SeqCst);
    }
}

impl Counter {
    fn total(&self) -> usize {
        self.0.load(Ordering::SeqCst)
    }
}

#[tokio::test]
async fn without_acks_the_shell_pauses_and_an_ack_resumes_it() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let target = SshTarget {
        connection_id: Some(Uuid::new_v4()),
        connection_name: "target".into(),
        host: env.host("target"),
        port: env.port("target"),
        username: env.user(),
        plan: AuthPlan::Password,
        connect_timeout: Duration::from_secs(5),
        keepalive_secs: 15,
        jump_hosts: Vec::new(),
    };
    let secrets = SecretStore::memory();
    secrets
        .set(
            target.connection_id.unwrap(),
            "target",
            SecretKind::Password,
            &SecretValue::new(env.password()),
        )
        .await
        .unwrap();
    let broker = Arc::new(PromptBroker::new());
    respond(&broker, vec![]);
    let ctx = context(&env, dir.path(), broker, secrets);
    let quiet = Counter::default();
    let link = establish(
        &ctx,
        &target,
        Uuid::new_v4(),
        CancellationToken::new(),
        &quiet,
    )
    .await
    .expect("a link to the target");
    let channel = open_shell(&link.target, 80, 24).await.unwrap();

    let (input, receiver) = mpsc::unbounded_channel::<ShellInput>();
    let sink = Arc::new(Counter::default());
    let cancel = CancellationToken::new();
    let task = tokio::spawn({
        let sink = sink.clone();
        let cancel = cancel.clone();
        async move { pump(channel, receiver, cancel, &*sink).await }
    });

    input
        .send(ShellInput::Data(
            b"yes 0123456789 | head -c 40000000\n".to_vec(),
        ))
        .unwrap();
    tokio::time::sleep(Duration::from_secs(3)).await;
    let paused_at = sink.total();
    assert!(
        paused_at >= ACK_HIGH_WATER / 2,
        "output flows at first ({paused_at} bytes)"
    );
    assert!(
        paused_at <= ACK_HIGH_WATER + 2 * OUTPUT_CHUNK,
        "without acks the shell is not read past the high water mark ({paused_at} bytes)"
    );
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert_eq!(sink.total(), paused_at, "still paused");

    input.send(ShellInput::Ack(paused_at)).unwrap();
    tokio::time::sleep(Duration::from_secs(2)).await;
    assert!(sink.total() > paused_at, "an ack resumes the output");

    cancel.cancel();
    let _ = task.await;
    link.disconnect().await;
}
