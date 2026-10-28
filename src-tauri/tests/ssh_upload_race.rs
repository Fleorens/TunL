//! T47 against the podman target: two uploads of the same name at once keep both files whole, and a folder is
//! refused before anything reaches the server. `npm run test:ssh`.
#![cfg(feature = "test-env")]

mod support;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh_sftp::client::SftpSession;
use support::{TestEnv, context, respond};
use tokio_util::sync::CancellationToken;
use tunl_lib::error::ErrorKind;
use tunl_lib::prompts::PromptBroker;
use tunl_lib::secrets::{SecretKind, SecretStore, SecretValue};
use tunl_lib::sessions::{SessionEvent, SessionSink};
use tunl_lib::sftp::ops;
use tunl_lib::sftp::session::open_sftp;
use tunl_lib::sftp::transfer::{TransferEvent, TransferSink, upload};
use tunl_lib::ssh::auth::AuthPlan;
use tunl_lib::ssh::link::{SshLink, establish};
use tunl_lib::ssh::session::SshTarget;
use uuid::Uuid;

struct Quiet;

impl SessionSink for Quiet {
    fn event(&self, _event: SessionEvent) {}
    fn output(&self, _bytes: Vec<u8>) {}
}

#[derive(Default)]
struct Events(Mutex<Vec<TransferEvent>>);

impl TransferSink for Events {
    fn event(&self, event: TransferEvent) {
        self.0.lock().unwrap().push(event);
    }
}

impl Events {
    fn last(&self) -> Option<TransferEvent> {
        self.0.lock().unwrap().last().cloned()
    }
}

/// A link to the target, its SFTP session, and a fresh remote directory.
async fn sftp(env: &TestEnv, dir: &std::path::Path) -> (SshLink, SftpSession, String) {
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
    let ctx = context(env, dir, broker, secrets);
    let link = establish(
        &ctx,
        &target,
        Uuid::new_v4(),
        CancellationToken::new(),
        &Quiet,
    )
    .await
    .expect("a link to the target");
    let sftp = open_sftp(&link.target).await.unwrap();
    let base = format!("/tmp/tunl-race-{}", Uuid::new_v4());
    ops::mkdir(&sftp, &base).await.unwrap();
    (link, sftp, base)
}

fn done_path(events: &Events) -> String {
    match events.last() {
        Some(TransferEvent::Done { path }) => path,
        other => panic!("the upload did not finish: {other:?}"),
    }
}

#[tokio::test]
async fn two_uploads_of_the_same_name_at_once_keep_both_files_whole() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let (link, sftp, base) = sftp(&env, dir.path()).await;

    let size = 2 * 1024 * 1024;
    let first = dir.path().join("a").join("same.bin");
    let second = dir.path().join("b").join("same.bin");
    std::fs::create_dir_all(first.parent().unwrap()).unwrap();
    std::fs::create_dir_all(second.parent().unwrap()).unwrap();
    std::fs::write(&first, vec![b'a'; size]).unwrap();
    std::fs::write(&second, vec![b'b'; size]).unwrap();

    let (one, two) = (Events::default(), Events::default());
    tokio::join!(
        upload(&sftp, &first, &base, CancellationToken::new(), &one),
        upload(&sftp, &second, &base, CancellationToken::new(), &two),
    );
    let (path_one, path_two) = (done_path(&one), done_path(&two));
    assert_ne!(path_one, path_two, "two uploads never share a name");

    let mut names: Vec<String> = ops::list(&sftp, &base)
        .await
        .unwrap()
        .into_iter()
        .map(|entry| entry.name)
        .collect();
    names.sort();
    assert_eq!(
        names,
        vec!["same (1).bin".to_string(), "same.bin".to_string()]
    );

    let mut contents = vec![
        sftp.read(path_one).await.unwrap(),
        sftp.read(path_two).await.unwrap(),
    ];
    contents.sort();
    assert_eq!(contents, vec![vec![b'a'; size], vec![b'b'; size]]);

    ops::remove(&sftp, &base).await.unwrap();
    link.disconnect().await;
}

#[tokio::test]
async fn a_folder_is_refused_before_anything_reaches_the_server() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let (link, sftp, base) = sftp(&env, dir.path()).await;

    let folder = dir.path().join("photos");
    std::fs::create_dir_all(&folder).unwrap();
    let events = Events::default();
    upload(&sftp, &folder, &base, CancellationToken::new(), &events).await;
    match events.last() {
        Some(TransferEvent::Failed { error }) => {
            assert_eq!(error.kind, ErrorKind::Validation);
            assert_eq!(error.message, "localPath: is a directory");
        }
        other => panic!("a folder must be refused, got {other:?}"),
    }
    assert!(
        ops::list(&sftp, &base).await.unwrap().is_empty(),
        "nothing was created on the server"
    );

    ops::remove(&sftp, &base).await.unwrap();
    link.disconnect().await;
}
