//! T55 against the podman target: a folder downloads with its content, links are skipped and counted, a second
//! download takes a free name, and a cancel leaves no `.part`. `npm run test:ssh`.
#![cfg(feature = "test-env")]

mod support;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh_sftp::client::SftpSession;
use support::{TestEnv, context, respond};
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;
use tunl_lib::prompts::PromptBroker;
use tunl_lib::secrets::{SecretKind, SecretStore, SecretValue};
use tunl_lib::sessions::{SessionEvent, SessionSink};
use tunl_lib::sftp::ops;
use tunl_lib::sftp::session::open_sftp;
use tunl_lib::sftp::transfer::{TransferEvent, TransferSink};
use tunl_lib::sftp::tree::download_dir;
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
}

/// Create a remote file with `bytes`. `SftpSession::write` only opens an existing file (no `CREATE`).
async fn put(sftp: &SftpSession, path: &str, bytes: &[u8]) {
    let mut file = sftp.create(path).await.unwrap();
    file.write_all(bytes).await.unwrap();
    file.shutdown().await.unwrap();
}

/// A link to the target, its SFTP session, and a remote tree:
/// `<base>/photos/{a.txt, sub/b.txt, empty/, to-hostname -> /etc/hostname}`.
async fn tree(env: &TestEnv, dir: &std::path::Path) -> (SshLink, SftpSession, String) {
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
    let base = format!("/tmp/tunl-tree-{}", Uuid::new_v4());
    for folder in ["", "/photos", "/photos/sub", "/photos/empty"] {
        ops::mkdir(&sftp, &format!("{base}{folder}")).await.unwrap();
    }
    put(&sftp, &format!("{base}/photos/a.txt"), b"aaa").await;
    put(&sftp, &format!("{base}/photos/sub/b.txt"), b"bbbbb").await;
    // OpenSSH reads SSH_FXP_SYMLINK's two paths in reverse: russh-sftp's `symlink` gets the target first.
    sftp.symlink("/etc/hostname", format!("{base}/photos/to-hostname"))
        .await
        .unwrap();
    (link, sftp, base)
}

#[tokio::test]
async fn a_folder_downloads_with_its_content_and_skips_links() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let (link, sftp, base) = tree(&env, dir.path()).await;
    let local = tempfile::tempdir().unwrap();

    let events = Events::default();
    let remote = format!("{base}/photos");
    download_dir(
        &sftp,
        &remote,
        local.path(),
        CancellationToken::new(),
        &events,
    )
    .await;

    let all = events.all();
    assert!(all.contains(&TransferEvent::Counted {
        files: 2,
        bytes: 8,
        skipped: 1
    }));
    let top = local.path().join("photos");
    assert_eq!(
        all.last(),
        Some(&TransferEvent::Done {
            path: top.to_string_lossy().into_owned()
        })
    );
    for event in &all {
        if let TransferEvent::Progress { total, .. } = event {
            assert_eq!(*total, Some(8), "progress counts the whole folder");
        }
    }
    assert_eq!(std::fs::read(top.join("a.txt")).unwrap(), b"aaa");
    assert_eq!(
        std::fs::read(top.join("sub").join("b.txt")).unwrap(),
        b"bbbbb"
    );
    assert!(top.join("empty").is_dir());
    assert!(
        !top.join("to-hostname").exists(),
        "a link is never followed"
    );

    let again = Events::default();
    download_dir(
        &sftp,
        &remote,
        local.path(),
        CancellationToken::new(),
        &again,
    )
    .await;
    assert_eq!(
        again.all().last(),
        Some(&TransferEvent::Done {
            path: local
                .path()
                .join("photos (1)")
                .to_string_lossy()
                .into_owned()
        })
    );

    ops::remove(&sftp, &base).await.unwrap();
    link.disconnect().await;
}

#[tokio::test]
async fn a_cancelled_folder_download_leaves_no_part_file() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let (link, sftp, base) = tree(&env, dir.path()).await;
    put(
        &sftp,
        &format!("{base}/photos/big.bin"),
        &vec![7u8; 8 * 1024 * 1024],
    )
    .await;
    let local = tempfile::tempdir().unwrap();

    let cancel = CancellationToken::new();
    let events = Events::default();
    let stop = cancel.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(50)).await;
        stop.cancel();
    });
    download_dir(
        &sftp,
        &format!("{base}/photos"),
        local.path(),
        cancel,
        &events,
    )
    .await;

    assert_eq!(events.all().last(), Some(&TransferEvent::Cancelled));
    let mut parts = Vec::new();
    let mut stack = vec![local.path().to_path_buf()];
    while let Some(folder) = stack.pop() {
        for entry in std::fs::read_dir(&folder).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                stack.push(path);
            } else if path.to_string_lossy().ends_with(".part") {
                parts.push(path);
            }
        }
    }
    assert!(parts.is_empty(), "no .part left: {parts:?}");

    ops::remove(&sftp, &base).await.unwrap();
    link.disconnect().await;
}
