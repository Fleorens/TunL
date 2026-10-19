//! T26 against the podman target of T16: upload a file, download it back, byte for byte; cancel; never overwrite.
//! `npm run test:ssh`.
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
use tunl_lib::sftp::transfer::{TransferEvent, TransferSink, download, upload};
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
    fn all(&self) -> Vec<TransferEvent> {
        self.0.lock().unwrap().clone()
    }
    fn last(&self) -> Option<TransferEvent> {
        self.all().last().cloned()
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
    let base = format!("/tmp/tunl-transfer-{}", Uuid::new_v4());
    ops::mkdir(&sftp, &base).await.unwrap();
    (link, sftp, base)
}

/// Pseudo-random bytes, so a byte out of place shows.
fn payload(len: usize) -> Vec<u8> {
    (0..len).map(|i| ((i * 7919) % 251) as u8).collect()
}

#[tokio::test]
async fn upload_then_download_round_trips_byte_for_byte() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let (link, sftp, base) = sftp(&env, dir.path()).await;

    let local = dir.path().join("data.bin");
    let bytes = payload(3 * 1024 * 1024 + 17);
    std::fs::write(&local, &bytes).unwrap();

    let up = Events::default();
    upload(&sftp, &local, &base, CancellationToken::new(), &up).await;
    let remote = format!("{base}/data.bin");
    assert_eq!(
        up.last(),
        Some(TransferEvent::Done {
            path: remote.clone()
        })
    );
    let progress: Vec<u64> = up
        .all()
        .iter()
        .filter_map(|e| match e {
            TransferEvent::Progress {
                transferred, total, ..
            } => {
                assert_eq!(*total, Some(bytes.len() as u64));
                Some(*transferred)
            }
            _ => None,
        })
        .collect();
    assert_eq!(
        progress.last(),
        Some(&(bytes.len() as u64)),
        "the last progress is complete"
    );
    assert!(
        progress.windows(2).all(|w| w[0] <= w[1]),
        "progress never goes back"
    );

    // Uploaded again: the remote copy is not replaced.
    let again = Events::default();
    upload(&sftp, &local, &base, CancellationToken::new(), &again).await;
    assert_eq!(
        again.last(),
        Some(TransferEvent::Done {
            path: format!("{base}/data (1).bin")
        })
    );

    let downloads = tempfile::tempdir().unwrap();
    let down = Events::default();
    download(
        &sftp,
        &remote,
        downloads.path(),
        CancellationToken::new(),
        &down,
    )
    .await;
    let landed = downloads.path().join("data.bin");
    assert_eq!(
        down.last(),
        Some(TransferEvent::Done {
            path: landed.display().to_string()
        })
    );
    assert_eq!(std::fs::read(&landed).unwrap(), bytes);

    // Downloaded again: the local copy is not replaced either.
    let twice = Events::default();
    download(
        &sftp,
        &remote,
        downloads.path(),
        CancellationToken::new(),
        &twice,
    )
    .await;
    assert!(downloads.path().join("data (1).bin").exists());
    assert_eq!(
        std::fs::read_dir(downloads.path()).unwrap().count(),
        2,
        "no .part left"
    );

    ops::remove(&sftp, &base).await.unwrap();
    link.disconnect().await;
}

#[tokio::test]
async fn a_cancelled_transfer_leaves_no_partial_file() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let (link, sftp, base) = sftp(&env, dir.path()).await;
    let local = dir.path().join("big.bin");
    std::fs::write(&local, payload(64 * 1024 * 1024)).unwrap();

    // Cancelled as soon as the first progress comes in.
    let cancel = CancellationToken::new();
    let events = Arc::new(Events::default());
    let watcher = {
        let (cancel, events) = (cancel.clone(), events.clone());
        tokio::spawn(async move {
            while !events
                .all()
                .iter()
                .any(|e| matches!(e, TransferEvent::Progress { .. }))
            {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
            cancel.cancel();
        })
    };
    upload(&sftp, &local, &base, cancel, &*events).await;
    watcher.await.unwrap();
    assert_eq!(events.last(), Some(TransferEvent::Cancelled));
    assert!(
        ops::list(&sftp, &base).await.unwrap().is_empty(),
        "nothing left remotely"
    );

    ops::remove(&sftp, &base).await.unwrap();
    link.disconnect().await;
}

#[tokio::test]
async fn a_missing_remote_file_fails_without_a_local_file() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let (link, sftp, base) = sftp(&env, dir.path()).await;
    let downloads = tempfile::tempdir().unwrap();

    let events = Events::default();
    download(
        &sftp,
        &format!("{base}/nope.txt"),
        downloads.path(),
        CancellationToken::new(),
        &events,
    )
    .await;
    match events.last() {
        Some(TransferEvent::Failed { error }) => assert_eq!(error.kind, ErrorKind::NotFound),
        other => panic!("expected a failure, got {other:?}"),
    }
    assert_eq!(std::fs::read_dir(downloads.path()).unwrap().count(), 0);

    ops::remove(&sftp, &base).await.unwrap();
    link.disconnect().await;
}
