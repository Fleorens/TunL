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
