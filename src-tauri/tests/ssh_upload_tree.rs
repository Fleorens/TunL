//! T56 against the podman target: a local folder uploads with its content, links are skipped and counted, a
//! second upload takes a free name, and a cancel leaves no `.part` on the server. `npm run test:ssh`.
#![cfg(feature = "test-env")]

mod support;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh_sftp::client::SftpSession;
use support::{TestEnv, context, respond};
use tokio_util::sync::CancellationToken;
use tunl_lib::prompts::PromptBroker;
use tunl_lib::secrets::{SecretKind, SecretStore, SecretValue};
use tunl_lib::sessions::{SessionEvent, SessionSink};
use tunl_lib::sftp::ops;
use tunl_lib::sftp::session::open_sftp;
use tunl_lib::sftp::transfer::{TransferEvent, TransferSink};
use tunl_lib::sftp::tree::upload_dir;
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
    let base = format!("/tmp/tunl-up-tree-{}", Uuid::new_v4());
    ops::mkdir(&sftp, &base).await.unwrap();
    (link, sftp, base)
}

/// `<root>/photos/{a.txt, sub/b.txt, empty/, to-hostname -> /etc/hostname}`.
fn local_tree(root: &std::path::Path) -> std::path::PathBuf {
    let photos = root.join("photos");
    std::fs::create_dir_all(photos.join("sub")).unwrap();
    std::fs::create_dir_all(photos.join("empty")).unwrap();
    std::fs::write(photos.join("a.txt"), b"aaa").unwrap();
    std::fs::write(photos.join("sub").join("b.txt"), b"bbbbb").unwrap();
    std::os::unix::fs::symlink("/etc/hostname", photos.join("to-hostname")).unwrap();
    photos
}

#[tokio::test]
async fn a_folder_uploads_with_its_content_and_skips_links() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let (link, sftp, base) = sftp(&env, dir.path()).await;
    let local = tempfile::tempdir().unwrap();
    let photos = local_tree(local.path());

    let events = Events::default();
    upload_dir(&sftp, &photos, &base, CancellationToken::new(), &events).await;

    let all = events.all();
    assert!(all.contains(&TransferEvent::Counted {
        files: 2,
        bytes: 8,
        skipped: 1
    }));
    assert_eq!(
        all.last(),
        Some(&TransferEvent::Done {
            path: format!("{base}/photos")
        })
    );
    assert_eq!(
        sftp.read(format!("{base}/photos/a.txt")).await.unwrap(),
        b"aaa"
    );
    assert_eq!(
        sftp.read(format!("{base}/photos/sub/b.txt")).await.unwrap(),
        b"bbbbb"
    );
    assert!(
        sftp.try_exists(format!("{base}/photos/empty"))
            .await
            .unwrap()
    );
    assert!(
        !sftp
            .try_exists(format!("{base}/photos/to-hostname"))
            .await
            .unwrap(),
        "a link is never followed"
    );

    let again = Events::default();
    upload_dir(&sftp, &photos, &base, CancellationToken::new(), &again).await;
    assert_eq!(
        again.all().last(),
        Some(&TransferEvent::Done {
            path: format!("{base}/photos (1)")
        })
    );

    ops::remove(&sftp, &base).await.unwrap();
    link.disconnect().await;
}

#[tokio::test]
async fn a_cancelled_folder_upload_leaves_no_part_file_on_the_server() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let (link, sftp, base) = sftp(&env, dir.path()).await;
    let local = tempfile::tempdir().unwrap();
    let photos = local_tree(local.path());
    std::fs::write(photos.join("big.bin"), vec![7u8; 8 * 1024 * 1024]).unwrap();

    let cancel = CancellationToken::new();
    let stop = cancel.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(50)).await;
        stop.cancel();
    });
    let events = Events::default();
    upload_dir(&sftp, &photos, &base, cancel, &events).await;
    assert_eq!(events.all().last(), Some(&TransferEvent::Cancelled));

    let mut parts = Vec::new();
    let mut stack = vec![base.clone()];
    while let Some(folder) = stack.pop() {
        for entry in ops::list(&sftp, &folder).await.unwrap() {
            if entry.name.ends_with(".part") {
                parts.push(entry.path.clone());
            }
            if entry.kind == tunl_lib::sftp::EntryKind::Dir {
                stack.push(entry.path);
            }
        }
    }
    assert!(parts.is_empty(), "no .part left: {parts:?}");

    ops::remove(&sftp, &base).await.unwrap();
    link.disconnect().await;
}
