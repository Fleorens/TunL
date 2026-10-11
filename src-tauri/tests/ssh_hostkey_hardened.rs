//! T19b against the podman servers of T16: a key of another type, a revoked key, a hashed user file.
#![cfg(feature = "test-env")]

mod support;

use std::path::Path;
use std::sync::Arc;

use russh::keys::parse_public_key_base64;
use support::{TestEnv, blank_context, connect, respond};
use tunl_lib::error::{ErrorDetail, ErrorKind};
use tunl_lib::prompts::{PromptAnswer, PromptBroker};
use tunl_lib::secrets::SecretStore;
use tunl_lib::ssh::SshContext;
use tunl_lib::ssh::known_hosts::{KnownHosts, fingerprint};

// An ECDSA key that none of the servers has.
const KEY_EC: &str = "AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBG+hjIUfFDzc5XLJ/LvCqK1FO7u10XSVbfBvwNlHcqltQv5LGg8ZQxugdmnnA5I3KdTvCB+Z9mfjxKRpooFj+Sk=";

/// The target's line of the environment's known_hosts (`[host]:port ssh-ed25519 …`).
fn target_line(env: &TestEnv) -> String {
    let prefix = format!("[{}]:{} ", env.host("target"), env.port("target"));
    std::fs::read_to_string(env.known_hosts())
        .unwrap()
        .lines()
        .find(|line| line.starts_with(&prefix))
        .unwrap()
        .to_string()
}

#[tokio::test]
async fn a_host_recorded_with_another_key_type_is_refused_without_a_prompt() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let own = dir.path().join("known_hosts");
    std::fs::write(
        &own,
        format!(
            "[{}]:{} ecdsa-sha2-nistp256 {KEY_EC}\n",
            env.host("target"),
            env.port("target")
        ),
    )
    .unwrap();

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
            known_fingerprint: fingerprint(&parse_public_key_base64(KEY_EC).unwrap()),
            known_hosts_path: own.to_string_lossy().into_owned(),
            line: 1,
            removable: true,
        })
    );
    assert!(
        asked.lock().unwrap().is_empty(),
        "no « unknown host » prompt"
    );
}

#[tokio::test]
async fn a_revoked_host_key_is_refused_without_a_prompt() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join("known_hosts"),
        format!("@revoked {}\n", target_line(&env)),
    )
    .unwrap();

    let broker = Arc::new(PromptBroker::new());
    let asked = respond(&broker, vec![PromptAnswer::Accept]);
    let ctx = blank_context(dir.path(), broker, SecretStore::memory());

    let error = connect(&env, &ctx, "target").await.err().unwrap();
    assert_eq!(error.kind, ErrorKind::HostKeyRejected);
    assert!(
        asked.lock().unwrap().is_empty(),
        "no prompt for a revoked key"
    );
}

/// A user file hashed by `ssh-keygen -H`, as Debian and Ubuntu write it (HashKnownHosts yes).
fn hashed_copy(env: &TestEnv, dir: &Path) -> std::path::PathBuf {
    let path = dir.join("user_known_hosts");
    std::fs::copy(env.known_hosts(), &path).unwrap();
    let status = std::process::Command::new("ssh-keygen")
        .arg("-H")
        .arg("-f")
        .arg(&path)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .unwrap();
    assert!(status.success());
    let text = std::fs::read_to_string(&path).unwrap();
    // Every host is hashed; ssh-keyscan's `#` comments stay as they are.
    assert!(
        text.lines()
            .all(|line| line.starts_with("|1|") || line.starts_with('#'))
    );
    path
}

#[tokio::test]
async fn a_hashed_user_file_is_trusted_without_a_prompt() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let user = hashed_copy(&env, dir.path());

    let broker = Arc::new(PromptBroker::new());
    let asked = respond(&broker, vec![]);
    let ctx = SshContext {
        known_hosts: Arc::new(KnownHosts::new(dir.path().join("known_hosts"), Some(user))),
        prompts: broker,
        secrets: Arc::new(SecretStore::memory()),
        agent_socket: None,
    };

    let handle = connect(&env, &ctx, "target").await.unwrap();
    assert!(!handle.is_closed());
    assert!(asked.lock().unwrap().is_empty());
}
