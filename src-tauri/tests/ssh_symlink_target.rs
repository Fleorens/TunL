//! T48 against the podman target: a link says what it points to, a broken link says nothing. `npm run test:ssh`.
#![cfg(feature = "test-env")]

mod support;

use std::sync::Arc;
use std::time::Duration;

use support::{TestEnv, context, respond};
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;
use tunl_lib::prompts::PromptBroker;
use tunl_lib::secrets::{SecretKind, SecretStore, SecretValue};
use tunl_lib::sessions::{SessionEvent, SessionSink};
use tunl_lib::sftp::session::open_sftp;
use tunl_lib::sftp::{EntryKind, ops};
use tunl_lib::ssh::auth::AuthPlan;
use tunl_lib::ssh::link::establish;
use tunl_lib::ssh::session::SshTarget;
use uuid::Uuid;

struct Quiet;

impl SessionSink for Quiet {
    fn event(&self, _event: SessionEvent) {}
    fn output(&self, _bytes: Vec<u8>) {}
}

#[tokio::test]
async fn a_link_says_what_it_points_to() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
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
    let ctx = context(&env, dir.path(), broker, secrets);
    let link = establish(&ctx, &target, Uuid::new_v4(), CancellationToken::new(), &Quiet)
        .await
        .expect("a link to the target");
    let sftp = open_sftp(&link.target).await.unwrap();
    let base = format!("/tmp/tunl-links-{}", Uuid::new_v4());
    ops::mkdir(&sftp, &base).await.unwrap();

    let file = format!("{base}/file.txt");
    let folder = format!("{base}/folder");
    let mut created = sftp.create(file.clone()).await.unwrap();
    created.write_all(b"hello").await.unwrap();
    created.shutdown().await.unwrap();
    ops::mkdir(&sftp, &folder).await.unwrap();
    // OpenSSH reads SSH_FXP_SYMLINK's two paths in reverse: russh-sftp's `symlink` gets the target first.
    sftp.symlink(file.clone(), format!("{base}/to-file")).await.unwrap();
    sftp.symlink(folder.clone(), format!("{base}/to-folder")).await.unwrap();
    sftp.symlink(format!("{base}/missing"), format!("{base}/broken"))
        .await
        .unwrap();

    let kinds: Vec<(String, EntryKind, Option<EntryKind>)> = ops::list(&sftp, &base)
        .await
        .unwrap()
        .into_iter()
        .map(|entry| (entry.name, entry.kind, entry.target_kind))
        .collect();
    assert_eq!(
        kinds,
        vec![
            ("broken".to_string(), EntryKind::Symlink, None),
            ("file.txt".to_string(), EntryKind::File, None),
            ("folder".to_string(), EntryKind::Dir, None),
            ("to-file".to_string(), EntryKind::Symlink, Some(EntryKind::File)),
            ("to-folder".to_string(), EntryKind::Symlink, Some(EntryKind::Dir)),
        ]
    );

    ops::remove(&sftp, &base).await.unwrap();
    link.disconnect().await;
}
