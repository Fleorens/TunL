//! T28 against the podman environment of T16: an RDP tab behind a bastion. FreeRDP is not needed: a fake client reads
//! its arguments on stdin, connects to the `/v:` address it got (the tunnel) and saves the first line it receives.
//! The "RDP host" is the hidden SSH server, so that first line is an SSH banner. `npm run test:ssh`.
#![cfg(feature = "test-env")]

mod support;

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use support::{TestEnv, context, respond};
use tokio_util::sync::CancellationToken;
use tunl_lib::model::RdpSettings;
use tunl_lib::prompts::PromptBroker;
use tunl_lib::rdp::args::RdpCredentials;
use tunl_lib::rdp::session::{RdpRun, RdpTarget, run_rdp_session};
use tunl_lib::secrets::{SecretKind, SecretStore, SecretValue};
use tunl_lib::sessions::{CloseReason, SessionEvent, SessionSink, StepKind, StepState};
use tunl_lib::ssh::auth::AuthPlan;
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

/// A fake FreeRDP: saves its stdin, connects to the `/v:` it was given, saves the first line it reads, exits 0.
fn fake_client(dir: &Path) -> PathBuf {
    let path = dir.join("fake-freerdp");
    let script = format!(
        "#!/bin/bash\ncat > '{d}/stdin'\nv=$(grep '^/v:' '{d}/stdin' | head -1)\nhp=${{v#/v:}}\n\
         exec 3<>/dev/tcp/${{hp%:*}}/${{hp##*:}}\nhead -1 <&3 > '{d}/banner'\nexit 0\n",
        d = dir.display()
    );
    std::fs::write(&path, script).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path
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

fn steps(events: &[SessionEvent]) -> Vec<(StepKind, StepState)> {
    events
        .iter()
        .filter_map(|e| match e {
            SessionEvent::Step { step, state, .. } => Some((*step, *state)),
            _ => None,
        })
        .collect()
}

#[tokio::test]
async fn an_rdp_tab_behind_a_bastion_reaches_its_host_through_the_tunnel() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let via = bastion(&env);
    let secrets = SecretStore::memory();
    secrets
        .set(
            via.connection_id.unwrap(),
            "bastion",
            SecretKind::Password,
            &SecretValue::new(env.password()),
        )
        .await
        .unwrap();
    let broker = Arc::new(PromptBroker::new());
    respond(&broker, vec![]);
    let ctx = context(&env, dir.path(), broker, secrets);

    let run = RdpRun {
        id: Uuid::new_v4(),
        target: RdpTarget {
            connection_id: Uuid::new_v4(),
            name: "desk".into(),
            host: env.host("hidden"),
            port: env.port("hidden"),
            username: Some("admin".into()),
            settings: RdpSettings::default(),
            via: Some(via),
        },
        credentials: RdpCredentials {
            username: Some("admin".into()),
            password: Some(SecretValue::new("rdp-secret")),
        },
        client: fake_client(dir.path()),
        cancel: CancellationToken::new(),
    };
    let recorder = Arc::new(Recorder::default());
    let sink: Arc<dyn SessionSink> = recorder.clone();
    tokio::time::timeout(Duration::from_secs(20), run_rdp_session(ctx, run, sink))
        .await
        .expect("the session ends with the client");

    let events = recorder.0.lock().unwrap().clone();
    assert_eq!(
        steps(&events),
        [
            (StepKind::Target, StepState::Started),
            (StepKind::Target, StepState::Done),
            (StepKind::HostKey, StepState::Started),
            (StepKind::HostKey, StepState::Done),
            (StepKind::Auth, StepState::Started),
            (StepKind::Auth, StepState::Done),
            (StepKind::Open, StepState::Started),
            (StepKind::Open, StepState::Done),
            (StepKind::Launch, StepState::Started),
            (StepKind::Launch, StepState::Done),
        ],
        "{events:?}"
    );
    assert!(events.contains(&SessionEvent::Connected));
    assert_eq!(
        events.last(),
        Some(&SessionEvent::Closed {
            reason: CloseReason::ProcessExited,
            exit_status: Some(0),
        })
    );

    // The client was pointed at the tunnel, not at the hidden host (which this machine cannot reach).
    let stdin = std::fs::read_to_string(dir.path().join("stdin")).unwrap();
    assert!(stdin.starts_with("/v:127.0.0.1:"), "{stdin}");
    let banner = std::fs::read_to_string(dir.path().join("banner")).unwrap();
    assert!(
        banner.starts_with("SSH-2.0-"),
        "the tunnel reached the hidden host: {banner:?}"
    );
    // The tunnel's address is in the log, for the RDP card.
    assert!(events.iter().any(|e| matches!(
        e,
        SessionEvent::Log { line } if line.starts_with("tunnel 127.0.0.1:")
    )));
}
