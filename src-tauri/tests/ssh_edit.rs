//! T57 against the podman target: a remote file is fetched into a private folder, pushed back in place (its
//! permissions kept), and never written over a newer remote version without being asked. `npm run test:ssh`.
#![cfg(feature = "test-env")]

mod support;

use std::os::unix::fs::PermissionsExt;
use std::sync::Arc;
use std::time::Duration;

use russh_sftp::client::SftpSession;
use support::{TestEnv, context, respond};
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;
use tunl_lib::prompts::PromptBroker;
use tunl_lib::secrets::{SecretKind, SecretStore, SecretValue};
use tunl_lib::sessions::{SessionEvent, SessionSink};
use tunl_lib::sftp::edit::{PushError, clear_edits, fetch, push, stamp};
use tunl_lib::sftp::ops;
use tunl_lib::sftp::session::open_sftp;
use tunl_lib::ssh::auth::AuthPlan;
use tunl_lib::ssh::link::{SshLink, establish};
use tunl_lib::ssh::session::SshTarget;
use uuid::Uuid;

struct Quiet;

impl SessionSink for Quiet {
    fn event(&self, _event: SessionEvent) {}
    fn output(&self, _bytes: Vec<u8>) {}
}

/// A link to the target, its SFTP session, and a fresh remote directory holding `app.conf` (mode 0640).
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
    let base = format!("/tmp/tunl-edit-{}", Uuid::new_v4());
    ops::mkdir(&sftp, &base).await.unwrap();
    let mut file = sftp.create(format!("{base}/app.conf")).await.unwrap();
    file.write_all(b"port = 80\n").await.unwrap();
    file.shutdown().await.unwrap();
    ops::chmod(&sftp, &format!("{base}/app.conf"), 0o640)
        .await
        .unwrap();
    (link, sftp, base)
}

fn mode(path: &std::path::Path) -> u32 {
    std::fs::metadata(path).unwrap().permissions().mode() & 0o777
}

#[tokio::test]
async fn a_file_is_fetched_privately_then_pushed_back_in_place() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let (link, sftp, base) = sftp(&env, dir.path()).await;
    let edit_dir = dir.path().join("run").join("tunl").join("edit");
    let remote = format!("{base}/app.conf");

    let id = Uuid::new_v4();
    let (local, first) = fetch(&sftp, &remote, &edit_dir, id).await.unwrap();
    assert_eq!(local, edit_dir.join(id.to_string()).join("app.conf"));
    assert_eq!(std::fs::read(&local).unwrap(), b"port = 80\n");
    assert_eq!(mode(&local), 0o600);
    assert_eq!(mode(local.parent().unwrap()), 0o700);
    assert_eq!(mode(&edit_dir), 0o700);
    assert_eq!(first.size, 10);

    std::fs::write(&local, b"port = 8080\n").unwrap();
    let second = push(&sftp, &local, &remote, Some(first)).await.unwrap();
    assert_eq!(second.size, 12);
    assert_eq!(sftp.read(remote.clone()).await.unwrap(), b"port = 8080\n");
    let remote_mode = sftp
        .metadata(remote.clone())
        .await
        .unwrap()
        .permissions
        .unwrap()
        & 0o777;
    assert_eq!(
        remote_mode, 0o640,
        "an in-place write keeps the permissions"
    );
    assert_eq!(stamp(&sftp, &remote).await.unwrap(), second);

    clear_edits(&edit_dir).unwrap();
    assert!(!edit_dir.exists());
    ops::remove(&sftp, &base).await.unwrap();
    link.disconnect().await;
}

#[tokio::test]
async fn a_newer_remote_version_is_never_overwritten_unasked() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let (link, sftp, base) = sftp(&env, dir.path()).await;
    let edit_dir = dir.path().join("edit");
    let remote = format!("{base}/app.conf");

    let (local, opened) = fetch(&sftp, &remote, &edit_dir, Uuid::new_v4())
        .await
        .unwrap();
    // Someone else writes the file on the server meanwhile.
    sftp.write(remote.clone(), b"port = 443 # theirs\n")
        .await
        .unwrap();
    std::fs::write(&local, b"port = 8080\n").unwrap();

    match push(&sftp, &local, &remote, Some(opened)).await {
        Err(PushError::Conflict) => {}
        other => panic!("a changed remote file must be a conflict, got {other:?}"),
    }
    assert_eq!(
        sftp.read(remote.clone()).await.unwrap(),
        b"port = 443 # theirs\n"
    );

    push(&sftp, &local, &remote, None).await.unwrap();
    assert_eq!(sftp.read(remote.clone()).await.unwrap(), b"port = 8080\n");

    sftp.remove_file(remote.clone()).await.unwrap();
    assert!(
        push(&sftp, &local, &remote, None).await.is_err(),
        "a file deleted on the server is not created again"
    );

    ops::remove(&sftp, &base).await.unwrap();
    link.disconnect().await;
}
