//! T24 against the podman target of T16: an SFTP session and the explorer's operations. `npm run test:ssh`.
//! Every test works in its own directory under `/tmp` of the target container.
#![cfg(feature = "test-env")]

mod support;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh_sftp::client::SftpSession;
use support::{TestEnv, context, respond};
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;
use tunl_lib::error::ErrorKind;
use tunl_lib::prompts::PromptBroker;
use tunl_lib::secrets::{SecretKind, SecretStore, SecretValue};
use tunl_lib::sessions::{CloseReason, SessionEvent, SessionSink, StepKind, StepState};
use tunl_lib::sftp::session::{SftpRun, open_sftp, run_sftp_session};
use tunl_lib::sftp::{EntryKind, SftpRegistry, ops};
use tunl_lib::ssh::SshContext;
use tunl_lib::ssh::auth::AuthPlan;
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

impl Recorder {
    fn events(&self) -> Vec<SessionEvent> {
        self.0.lock().unwrap().clone()
    }
}

fn target(env: &TestEnv) -> SshTarget {
    SshTarget {
        connection_id: Some(Uuid::new_v4()),
        connection_name: "target".into(),
        host: env.host("target"),
        port: env.port("target"),
        username: env.user(),
        plan: AuthPlan::Password,
        connect_timeout: Duration::from_secs(5),
        keepalive_secs: 15,
        jump_hosts: Vec::new(),
    }
}

async fn ctx_for(env: &TestEnv, dir: &std::path::Path, target: &SshTarget) -> SshContext {
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
    context(env, dir, broker, secrets)
}

/// Create (or replace) a remote file with `bytes`. `SftpSession::write` only opens an existing file.
async fn put(sftp: &SftpSession, path: &str, bytes: &[u8]) {
    let mut file = sftp.create(path).await.unwrap();
    file.write_all(bytes).await.unwrap();
    file.shutdown().await.unwrap();
}

/// A symbolic link at `link` pointing to `target`. OpenSSH reads the two paths of SSH_FXP_SYMLINK in the reverse
/// order of the protocol draft: russh-sftp's `symlink(path, target)` gets the target first.
async fn link_to(sftp: &SftpSession, target: &str, link: &str) {
    sftp.symlink(target, link).await.unwrap();
}

/// A link to the target, an SFTP session on it, and a fresh directory to play in.
async fn sftp(env: &TestEnv, dir: &std::path::Path) -> (SshLink, SftpSession, String) {
    let target = target(env);
    let ctx = ctx_for(env, dir, &target).await;
    let link = establish(
        &ctx,
        &target,
        Uuid::new_v4(),
        CancellationToken::new(),
        &Recorder::default(),
    )
    .await
    .expect("a link to the target");
    let sftp = open_sftp(&link.target).await.unwrap();
    let base = format!("/tmp/tunl-sftp-{}", Uuid::new_v4());
    ops::mkdir(&sftp, &base).await.unwrap();
    (link, sftp, base)
}

#[tokio::test]
async fn the_home_directory_and_a_listing_with_every_kind() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let (link, sftp, base) = sftp(&env, dir.path()).await;

    let home = ops::realpath(&sftp, ".").await.unwrap();
    assert_eq!(home, format!("/home/{}", env.user()));

    put(&sftp, &format!("{base}/b.txt"), b"hello").await;
    put(&sftp, &format!("{base}/.hidden"), b"").await;
    ops::mkdir(&sftp, &format!("{base}/a-dir")).await.unwrap();
    link_to(&sftp, &format!("{base}/b.txt"), &format!("{base}/link")).await;

    let entries = ops::list(&sftp, &base).await.unwrap();
    let summary: Vec<(&str, EntryKind, bool)> = entries
        .iter()
        .map(|e| (e.name.as_str(), e.kind, e.hidden))
        .collect();
    assert_eq!(
        summary,
        [
            (".hidden", EntryKind::File, true),
            ("a-dir", EntryKind::Dir, false),
            ("b.txt", EntryKind::File, false),
            ("link", EntryKind::Symlink, false),
        ]
    );
    let file = &entries[2];
    assert_eq!(file.path, format!("{base}/b.txt"));
    assert_eq!(file.size, 5);
    assert!(file.modified_at.is_some());
    assert!(file.permissions.is_some_and(|mode| mode <= 0o7777));

    ops::remove(&sftp, &base).await.unwrap();
    link.disconnect().await;
}

#[tokio::test]
async fn mkdir_rename_and_chmod() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let (link, sftp, base) = sftp(&env, dir.path()).await;

    ops::mkdir(&sftp, &format!("{base}/new")).await.unwrap();
    let again = ops::mkdir(&sftp, &format!("{base}/new")).await.unwrap_err();
    assert_eq!(again.kind, ErrorKind::Sftp);

    ops::rename(&sftp, &format!("{base}/new"), &format!("{base}/renamed"))
        .await
        .unwrap();
    ops::chmod(&sftp, &format!("{base}/renamed"), 0o750)
        .await
        .unwrap();
    let entries = ops::list(&sftp, &base).await.unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].name, "renamed");
    assert_eq!(entries[0].permissions, Some(0o750));

    let too_big = ops::chmod(&sftp, &format!("{base}/renamed"), 0o17777)
        .await
        .unwrap_err();
    assert_eq!(too_big.kind, ErrorKind::Validation);

    ops::remove(&sftp, &base).await.unwrap();
    link.disconnect().await;
}

#[tokio::test]
async fn a_recursive_removal_counts_first_and_never_follows_a_link() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let (link, sftp, base) = sftp(&env, dir.path()).await;

    // Outside the tree: must survive the removal of a link that points to it.
    let outside = format!("{base}/keep");
    ops::mkdir(&sftp, &outside).await.unwrap();
    put(&sftp, &format!("{outside}/precious"), b"x").await;

    let tree = format!("{base}/tree");
    ops::mkdir(&sftp, &tree).await.unwrap();
    ops::mkdir(&sftp, &format!("{tree}/sub")).await.unwrap();
    put(&sftp, &format!("{tree}/one"), b"1").await;
    put(&sftp, &format!("{tree}/sub/two"), b"2").await;
    link_to(&sftp, &outside, &format!("{tree}/to-keep")).await;

    // tree, sub, one, two, to-keep: the link counts as one entry, its target is not entered.
    assert_eq!(ops::count(&sftp, &tree).await.unwrap(), 5);
    assert_eq!(ops::count(&sftp, &format!("{tree}/one")).await.unwrap(), 1);

    ops::remove(&sftp, &tree).await.unwrap();
    let left: Vec<String> = ops::list(&sftp, &base)
        .await
        .unwrap()
        .into_iter()
        .map(|e| e.name)
        .collect();
    assert_eq!(left, ["keep"]);
    let kept = ops::list(&sftp, &outside).await.unwrap();
    assert_eq!(kept.len(), 1, "the link's target is untouched");

    let root = ops::remove(&sftp, "/").await.unwrap_err();
    assert_eq!(root.kind, ErrorKind::Validation);
    let missing = ops::list(&sftp, &format!("{base}/nope")).await.unwrap_err();
    assert_eq!(missing.kind, ErrorKind::NotFound);

    ops::remove(&sftp, &base).await.unwrap();
    link.disconnect().await;
}

#[tokio::test]
async fn an_sftp_tab_from_the_first_step_to_the_close() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let target = target(&env);
    let ctx = ctx_for(&env, dir.path(), &target).await;
    let registry = Arc::new(SftpRegistry::default());
    let recorder = Arc::new(Recorder::default());
    let cancel = CancellationToken::new();
    let id = Uuid::new_v4();
    let run = SftpRun {
        id,
        target,
        cancel: cancel.clone(),
    };
    let sink: Arc<dyn SessionSink> = recorder.clone();
    let task = tokio::spawn(run_sftp_session(ctx, run, sink, registry.clone()));

    for _ in 0..500 {
        if recorder.events().contains(&SessionEvent::Connected) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let events = recorder.events();
    assert_eq!(
        events[events.len() - 3..],
        [
            SessionEvent::Step {
                step: StepKind::Open,
                label: "sftp".into(),
                state: StepState::Started,
            },
            SessionEvent::Step {
                step: StepKind::Open,
                label: "sftp".into(),
                state: StepState::Done,
            },
            SessionEvent::Connected,
        ]
    );
    let session = registry.get(id).expect("registered while connected");
    assert!(ops::realpath(&session, ".").await.is_ok());
    drop(session);

    cancel.cancel();
    tokio::time::timeout(Duration::from_secs(10), task)
        .await
        .expect("the tab ends")
        .unwrap();
    assert_eq!(
        recorder.events().last(),
        Some(&SessionEvent::Closed {
            reason: CloseReason::UserClosed,
            exit_status: None,
        })
    );
    let gone = registry.get(id).err().expect("removed once closed");
    assert_eq!(gone.kind, ErrorKind::NotFound);
}
