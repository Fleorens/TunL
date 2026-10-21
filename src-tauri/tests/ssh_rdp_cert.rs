//! T28c against the podman environment of T16: behind a bastion, FreeRDP is pointed at the connection's own
//! tunnel port, every time, and told the real host's name, so the certificate it trusted is found again.
//! A fake client records its arguments (as in `ssh_rdp.rs`). `npm run test:ssh`.
#![cfg(feature = "test-env")]

mod support;

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use support::{TestEnv, context, respond};
use tokio_util::sync::CancellationToken;
use tunl_lib::model::RdpSettings;
use tunl_lib::prompts::PromptBroker;
use tunl_lib::rdp::args::RdpCredentials;
use tunl_lib::rdp::session::{RdpRun, RdpTarget, run_rdp_session};
use tunl_lib::secrets::{SecretKind, SecretStore, SecretValue};
use tunl_lib::sessions::{SessionEvent, SessionSink};
use tunl_lib::ssh::auth::AuthPlan;
use tunl_lib::ssh::forward::tunnel_port;
use tunl_lib::ssh::session::SshTarget;
use uuid::Uuid;

struct Quiet;

impl SessionSink for Quiet {
    fn event(&self, _event: SessionEvent) {}
    fn output(&self, _bytes: Vec<u8>) {}
}

/// A fake FreeRDP: saves its stdin, then exits 0.
fn fake_client(dir: &Path) -> PathBuf {
    let path = dir.join("fake-freerdp");
    let script = format!("#!/bin/bash\ncat > '{}/stdin'\nexit 0\n", dir.display());
    std::fs::write(&path, script).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path
}

async fn run_once(env: &TestEnv, dir: &Path, connection_id: Uuid, bastion_id: Uuid) -> Vec<String> {
    let secrets = SecretStore::memory();
    secrets
        .set(
            bastion_id,
            "bastion",
            SecretKind::Password,
            &SecretValue::new(env.password()),
        )
        .await
        .unwrap();
    let broker = Arc::new(PromptBroker::new());
    respond(&broker, vec![]);
    let ctx = context(env, dir, broker, secrets);
    let run = RdpRun {
        id: Uuid::new_v4(),
        target: RdpTarget {
            connection_id,
            name: "desk".into(),
            host: env.host("hidden"),
            port: env.port("hidden"),
            username: Some("admin".into()),
            settings: RdpSettings::default(),
            via: Some(SshTarget {
                connection_id: Some(bastion_id),
                connection_name: "bastion".into(),
                host: env.host("bastion"),
                port: env.port("bastion"),
                username: env.user(),
                plan: AuthPlan::Password,
                connect_timeout: Duration::from_secs(5),
                keepalive_secs: 15,
                jump_hosts: Vec::new(),
            }),
        },
        credentials: RdpCredentials::default(),
        client: fake_client(dir),
        cancel: CancellationToken::new(),
    };
    tokio::time::timeout(
        Duration::from_secs(20),
        run_rdp_session(ctx, run, Arc::new(Quiet)),
    )
    .await
    .expect("the session ends with the client");
    std::fs::read_to_string(dir.join("stdin"))
        .unwrap()
        .lines()
        .map(str::to_string)
        .collect()
}

#[tokio::test]
async fn two_sessions_of_a_connection_use_the_same_port_and_name_the_real_host() {
    let env = TestEnv::load();
    let (connection_id, bastion_id) = (Uuid::new_v4(), Uuid::new_v4());
    let expected = format!("/v:127.0.0.1:{}", tunnel_port(connection_id));

    for _ in 0..2 {
        let dir = tempfile::tempdir().unwrap();
        let lines = run_once(&env, dir.path(), connection_id, bastion_id).await;
        assert_eq!(lines[0], expected);
        assert_eq!(lines[1], format!("/server-name:{}", env.host("hidden")));
    }
}
