use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use super::args::{RdpCredentials, RdpEndpoint, build_args};
use super::launch::{MAX_LOG_LINE, filter_log_line, launch, watch};
use super::session::{RdpRun, RdpTarget, resolve_rdp, run_rdp_session};
use crate::error::ErrorKind;
use crate::model::{Connection, ConnectionInput, Protocol, RdpSettings, SshDefaults};
use crate::prompts::PromptBroker;
use crate::secrets::{SecretStore, SecretValue};
use crate::sessions::{CloseReason, SessionEvent, SessionSink, StepKind, StepState};
use crate::ssh::SshContext;
use crate::ssh::known_hosts::KnownHosts;
use crate::store::Store;

#[derive(Default)]
struct Recorder(Mutex<Vec<SessionEvent>>);

impl SessionSink for Recorder {
    fn event(&self, event: SessionEvent) {
        self.0.lock().unwrap().push(event);
    }
    fn output(&self, _bytes: Vec<u8>) {}
}

impl Recorder {
    fn events(&self) -> Vec<SessionEvent> {
        self.0.lock().unwrap().clone()
    }
    fn logs(&self) -> Vec<String> {
        self.events()
            .into_iter()
            .filter_map(|e| match e {
                SessionEvent::Log { line } => Some(line),
                _ => None,
            })
            .collect()
    }
}

/// A fake FreeRDP in `dir`: it saves its command line (`argv`) and its stdin (`stdin`), prints two lines on stdout
/// (one of them about a password) and one on stderr, runs `then`, and exits with `code`.
fn fake_client(dir: &Path, then: &str, code: i32) -> PathBuf {
    let path = dir.join("fake-freerdp");
    let script = format!(
        "#!/bin/sh\nprintf '%s\\n' \"$@\" > '{d}/argv'\ncat > '{d}/stdin'\n\
         echo '[INFO] connected to the server'\necho '[WARN] Password: hunter2'\n\
         echo '[ERROR] bitmap cache full' >&2\n{then}\nexit {code}\n",
        d = dir.display()
    );
    std::fs::write(&path, script).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path
}

fn endpoint() -> RdpEndpoint<'static> {
    RdpEndpoint {
        name: "ad-01",
        host: "10.0.0.5",
        port: 3389,
    }
}

fn admin() -> RdpCredentials {
    RdpCredentials {
        username: Some("admin".into()),
        password: Some(SecretValue::new("s3cret")),
    }
}

#[test]
fn log_lines_are_trimmed_cut_and_never_carry_a_credential() {
    assert_eq!(
        filter_log_line("  [INFO] connected  ").as_deref(),
        Some("[INFO] connected")
    );
    assert_eq!(filter_log_line("   "), None);
    for secret in [
        "Password: x",
        "using /p:abc",
        "[WARN] passwd changed",
        "Credentials for admin",
        "client secret ok",
    ] {
        assert_eq!(filter_log_line(secret), None, "{secret}");
    }
    let long = "x".repeat(MAX_LOG_LINE + 50);
    assert_eq!(
        filter_log_line(&long).map(|l| l.chars().count()),
        Some(MAX_LOG_LINE)
    );
}

#[tokio::test]
async fn the_arguments_go_on_stdin_and_only_args_from_stdin_on_the_command_line() {
    let dir = tempfile::tempdir().unwrap();
    let client = fake_client(dir.path(), "", 7);
    let args = build_args(&endpoint(), &RdpSettings::default(), &admin()).unwrap();

    let child = launch(&client, &args).await.unwrap();
    let recorder = Recorder::default();
    let ended = watch(child, CancellationToken::new(), &recorder).await;

    assert_eq!(ended, (CloseReason::ProcessExited, Some(7)));
    let argv = std::fs::read_to_string(dir.path().join("argv")).unwrap();
    assert_eq!(
        argv, "/args-from:stdin\n",
        "S4: nothing else on the command line"
    );
    let stdin = std::fs::read_to_string(dir.path().join("stdin")).unwrap();
    assert_eq!(stdin, *args.stdin_text());
    assert!(stdin.contains("/p:s3cret\n"));

    let mut logs = recorder.logs();
    logs.sort();
    assert_eq!(
        logs,
        [
            "[ERROR] bitmap cache full",
            "[INFO] connected to the server"
        ],
        "stdout and stderr both pass, the password line does not"
    );
}

#[tokio::test]
async fn closing_the_tab_kills_the_client() {
    let dir = tempfile::tempdir().unwrap();
    let client = fake_client(dir.path(), "sleep 30", 0);
    let args = build_args(
        &endpoint(),
        &RdpSettings::default(),
        &RdpCredentials::default(),
    )
    .unwrap();
    let child = launch(&client, &args).await.unwrap();

    let cancel = CancellationToken::new();
    let later = cancel.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(300)).await;
        later.cancel();
    });
    let started = Instant::now();
    let ended = watch(child, cancel, &Recorder::default()).await;
    assert_eq!(ended, (CloseReason::UserClosed, None));
    assert!(
        started.elapsed() < Duration::from_secs(5),
        "{:?}",
        started.elapsed()
    );
}

#[tokio::test]
async fn a_missing_client_is_an_rdp_error() {
    let args = build_args(
        &endpoint(),
        &RdpSettings::default(),
        &RdpCredentials::default(),
    )
    .unwrap();
    let error = launch(Path::new("/nonexistent/sdl-freerdp3"), &args)
        .await
        .unwrap_err();
    assert_eq!(error.kind, ErrorKind::Rdp);
}

fn connection(name: &str, protocol: Protocol, jump: Option<Uuid>) -> Connection {
    Connection::from_input(
        Uuid::new_v4(),
        ConnectionInput {
            name: name.into(),
            host: format!("{name}.lan"),
            username: Some("ops".into()),
            jump_host_id: jump,
            ..ConnectionInput::template(protocol)
        },
        1_000,
    )
}

fn defaults() -> SshDefaults {
    SshDefaults {
        connect_timeout_secs: 10,
        keepalive_secs: 30,
    }
}

#[test]
fn an_rdp_connection_resolves_with_its_bastion_as_an_ssh_target() {
    let outer = connection("outer", Protocol::Ssh, None);
    let bastion = connection("bastion", Protocol::Ssh, Some(outer.id));
    let desk = connection("desk", Protocol::Rdp, Some(bastion.id));
    let store = Store {
        groups: vec![],
        connections: vec![desk.clone(), bastion.clone(), outer.clone()],
    };
    let target = resolve_rdp(desk.id, &store, &defaults(), Some("ada")).unwrap();
    assert_eq!(target.host, "desk.lan");
    assert_eq!(target.port, 3389);
    let via = target.via.expect("a bastion");
    assert_eq!(via.connection_name, "bastion");
    assert_eq!(via.jump_hosts.len(), 1, "the bastion keeps its own chain");
    assert_eq!(via.jump_hosts[0].connection_name, "outer");

    let direct = connection("direct", Protocol::Rdp, None);
    let store = Store {
        groups: vec![],
        connections: vec![direct.clone()],
    };
    assert!(
        resolve_rdp(direct.id, &store, &defaults(), None)
            .unwrap()
            .via
            .is_none()
    );
}

#[test]
fn only_an_existing_rdp_connection_resolves() {
    let ssh = connection("web", Protocol::Ssh, None);
    let store = Store {
        groups: vec![],
        connections: vec![ssh.clone()],
    };
    let error = resolve_rdp(ssh.id, &store, &defaults(), None).unwrap_err();
    assert_eq!(error.kind, ErrorKind::Validation);
    let error = resolve_rdp(Uuid::new_v4(), &store, &defaults(), None).unwrap_err();
    assert_eq!(error.kind, ErrorKind::NotFound);
}

fn context(dir: &Path) -> SshContext {
    SshContext {
        known_hosts: Arc::new(KnownHosts::new(dir.join("known_hosts"), None)),
        prompts: Arc::new(PromptBroker::new()),
        secrets: Arc::new(SecretStore::memory()),
        agent_socket: None,
    }
}

fn direct_target(username: &str) -> RdpTarget {
    RdpTarget {
        connection_id: Uuid::new_v4(),
        name: "ad-01".into(),
        host: "10.0.0.5".into(),
        port: 3389,
        username: Some(username.into()),
        settings: RdpSettings::default(),
        via: None,
    }
}

fn launch_step(state: StepState) -> SessionEvent {
    SessionEvent::Step {
        step: StepKind::Launch,
        label: "fake-freerdp".into(),
        state,
    }
}

#[tokio::test]
async fn a_direct_rdp_tab_launches_then_ends_with_the_exit_code() {
    let dir = tempfile::tempdir().unwrap();
    let client = fake_client(dir.path(), "", 0);
    let recorder = Arc::new(Recorder::default());
    let run = RdpRun {
        id: Uuid::new_v4(),
        target: direct_target("admin"),
        credentials: RdpCredentials {
            username: Some("admin".into()),
            password: None,
        },
        client,
        cancel: CancellationToken::new(),
    };
    let sink: Arc<dyn SessionSink> = recorder.clone();
    run_rdp_session(context(dir.path()), run, sink).await;

    let events = recorder.events();
    assert_eq!(
        events[..3],
        [
            launch_step(StepState::Started),
            launch_step(StepState::Done),
            SessionEvent::Connected
        ]
    );
    assert_eq!(
        events.last(),
        Some(&SessionEvent::Closed {
            reason: CloseReason::ProcessExited,
            exit_status: Some(0),
        })
    );
    let stdin = std::fs::read_to_string(dir.path().join("stdin")).unwrap();
    assert!(stdin.starts_with("/v:10.0.0.5:3389\n/u:admin\n"), "{stdin}");
}

#[tokio::test]
async fn refused_arguments_fail_the_launch_step_and_nothing_starts() {
    let dir = tempfile::tempdir().unwrap();
    let client = fake_client(dir.path(), "", 0);
    let recorder = Arc::new(Recorder::default());
    let run = RdpRun {
        id: Uuid::new_v4(),
        target: direct_target("admin"),
        credentials: RdpCredentials {
            username: Some("ad\nmin".into()),
            password: None,
        },
        client,
        cancel: CancellationToken::new(),
    };
    let sink: Arc<dyn SessionSink> = recorder.clone();
    run_rdp_session(context(dir.path()), run, sink).await;

    let events = recorder.events();
    assert_eq!(
        events[..2],
        [
            launch_step(StepState::Started),
            launch_step(StepState::Failed)
        ]
    );
    assert!(
        matches!(&events[2], SessionEvent::Error { error } if error.kind == ErrorKind::Validation)
    );
    assert_eq!(events.len(), 3);
    assert!(!dir.path().join("argv").exists(), "the client never ran");
}
