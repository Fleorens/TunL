//! T18 against the podman servers of T16: every authentication method, secrets from the keyring or from a prompt.
//! `npm run test:ssh`.
#![cfg(feature = "test-env")]

mod support;

use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Arc;
use std::time::Duration;

use support::{Asked, TestEnv, connect, context, respond};
use tunl_lib::error::{AppResult, ErrorKind};
use tunl_lib::prompts::{InteractivePrompt, PromptAnswer, PromptBroker, PromptKind};
use tunl_lib::secrets::{SecretKind, SecretStore, SecretValue};
use tunl_lib::ssh::SshContext;
use tunl_lib::ssh::auth::{AuthPlan, AuthTarget, authenticate, keyboard_interactive};
use uuid::Uuid;

fn secret(value: &str, save: bool) -> PromptAnswer {
    PromptAnswer::Secret {
        value: SecretValue::new(value),
        save,
    }
}

fn target(env: &TestEnv, plan: AuthPlan, connection_id: Option<Uuid>) -> AuthTarget {
    AuthTarget {
        connection_id,
        connection_name: "target".into(),
        username: env.user(),
        host: env.host("target"),
        session_id: None,
        plan,
    }
}

/// A trusted context whose prompts follow `script`, and whose keyring already holds `stored`.
async fn setup(
    env: &TestEnv,
    dir: &Path,
    script: Vec<PromptAnswer>,
    stored: &[(Uuid, SecretKind, &str)],
) -> (SshContext, Asked) {
    let broker = Arc::new(PromptBroker::new());
    let asked = respond(&broker, script);
    let secrets = SecretStore::memory();
    for (id, kind, value) in stored {
        secrets
            .set(*id, "target", *kind, &SecretValue::new(*value))
            .await
            .unwrap();
    }
    (context(env, dir, broker, secrets), asked)
}

async fn login(env: &TestEnv, ctx: &SshContext, target: &AuthTarget) -> AppResult<()> {
    let mut handle = connect(env, ctx, "target").await?;
    authenticate(&mut handle, target, ctx).await
}

fn prompts(asked: &Asked) -> Vec<PromptKind> {
    asked
        .lock()
        .unwrap()
        .iter()
        .map(|r| r.prompt.clone())
        .collect()
}

async fn stored(ctx: &SshContext, id: Uuid, kind: SecretKind) -> Option<String> {
    ctx.secrets
        .get(id, kind)
        .await
        .unwrap()
        .map(|value| value.expose().to_string())
}

#[tokio::test]
async fn a_password_from_the_keyring_needs_no_prompt() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let id = Uuid::new_v4();
    let (ctx, asked) = setup(
        &env,
        dir.path(),
        vec![],
        &[(id, SecretKind::Password, &env.password())],
    )
    .await;

    login(&env, &ctx, &target(&env, AuthPlan::Password, Some(id)))
        .await
        .unwrap();
    assert!(prompts(&asked).is_empty());
}

#[tokio::test]
async fn a_prompted_password_is_saved_when_asked_to() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let id = Uuid::new_v4();
    let (ctx, asked) = setup(&env, dir.path(), vec![secret(&env.password(), true)], &[]).await;

    login(&env, &ctx, &target(&env, AuthPlan::Password, Some(id)))
        .await
        .unwrap();
    assert_eq!(
        prompts(&asked),
        vec![PromptKind::Password {
            connection_name: "target".into(),
            username: env.user(),
            host: env.host("target"),
            can_save: true,
            retry: false,
        }]
    );
    assert_eq!(
        stored(&ctx, id, SecretKind::Password).await,
        Some(env.password())
    );
}

#[tokio::test]
async fn a_wrong_stored_password_asks_again_and_keeps_the_keyring_unless_told() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let id = Uuid::new_v4();
    let (ctx, asked) = setup(
        &env,
        dir.path(),
        vec![secret(&env.password(), false)],
        &[(id, SecretKind::Password, "not-the-password")],
    )
    .await;

    login(&env, &ctx, &target(&env, AuthPlan::Password, Some(id)))
        .await
        .unwrap();
    assert!(matches!(
        prompts(&asked)[..],
        [PromptKind::Password { retry: true, .. }]
    ));
    assert_eq!(
        stored(&ctx, id, SecretKind::Password).await.as_deref(),
        Some("not-the-password")
    );
}

#[tokio::test]
async fn three_wrong_passwords_fail_with_an_auth_error() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let wrong = vec![
        secret("nope-1", false),
        secret("nope-2", false),
        secret("nope-3", false),
    ];
    let (ctx, asked) = setup(&env, dir.path(), wrong, &[]).await;

    let error = login(&env, &ctx, &target(&env, AuthPlan::Password, None))
        .await
        .unwrap_err();
    assert_eq!(error.kind, ErrorKind::Auth);
    assert!(!error.message.contains("nope"), "S7: {}", error.message);
    let asked = prompts(&asked);
    assert_eq!(asked.len(), 3);
    // A quick connection has no id: nothing can be saved.
    assert!(matches!(
        asked[0],
        PromptKind::Password {
            can_save: false,
            retry: false,
            ..
        }
    ));
    assert!(matches!(asked[2], PromptKind::Password { retry: true, .. }));
}

#[tokio::test]
async fn cancelling_the_password_prompt_is_cancelled() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let (ctx, _) = setup(&env, dir.path(), vec![PromptAnswer::Cancel], &[]).await;

    let error = login(&env, &ctx, &target(&env, AuthPlan::Password, None))
        .await
        .unwrap_err();
    assert_eq!(error.kind, ErrorKind::Cancelled);
}

#[tokio::test]
async fn unencrypted_keys_need_no_prompt() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    for key in ["ed25519", "rsa"] {
        let (ctx, asked) = setup(&env, dir.path(), vec![], &[]).await;
        let plan = AuthPlan::Key { path: env.key(key) };
        login(&env, &ctx, &target(&env, plan, None)).await.unwrap();
        assert!(prompts(&asked).is_empty(), "{key}");
    }
}

#[tokio::test]
async fn an_encrypted_key_asks_for_its_passphrase_and_saves_it() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let id = Uuid::new_v4();
    let (ctx, asked) = setup(&env, dir.path(), vec![secret(&env.passphrase(), true)], &[]).await;
    let path = env.key("ed25519Passphrase");

    login(
        &env,
        &ctx,
        &target(&env, AuthPlan::Key { path: path.clone() }, Some(id)),
    )
    .await
    .unwrap();
    assert_eq!(
        prompts(&asked),
        vec![PromptKind::Passphrase {
            connection_name: "target".into(),
            key_path: path,
            can_save: true,
            retry: false,
        }]
    );
    assert_eq!(
        stored(&ctx, id, SecretKind::Passphrase).await,
        Some(env.passphrase())
    );
}

#[tokio::test]
async fn a_wrong_passphrase_asks_again() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let script = vec![secret("wrong", false), secret(&env.passphrase(), false)];
    let (ctx, asked) = setup(&env, dir.path(), script, &[]).await;
    let plan = AuthPlan::Key {
        path: env.key("ed25519Passphrase"),
    };

    login(&env, &ctx, &target(&env, plan, None)).await.unwrap();
    let asked = prompts(&asked);
    assert_eq!(asked.len(), 2);
    assert!(matches!(
        asked[1],
        PromptKind::Passphrase { retry: true, .. }
    ));
}

#[tokio::test]
async fn a_stored_passphrase_needs_no_prompt() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let id = Uuid::new_v4();
    let (ctx, asked) = setup(
        &env,
        dir.path(),
        vec![],
        &[(id, SecretKind::Passphrase, &env.passphrase())],
    )
    .await;
    let plan = AuthPlan::Key {
        path: env.key("ed25519Passphrase"),
    };

    login(&env, &ctx, &target(&env, plan, Some(id)))
        .await
        .unwrap();
    assert!(prompts(&asked).is_empty());
}

#[tokio::test]
async fn a_missing_key_file_is_an_auth_error_naming_the_file() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let (ctx, _) = setup(&env, dir.path(), vec![], &[]).await;
    let plan = AuthPlan::Key {
        path: "/nonexistent/id_ed25519".into(),
    };

    let error = login(&env, &ctx, &target(&env, plan, None))
        .await
        .unwrap_err();
    assert_eq!(error.kind, ErrorKind::Auth);
    assert!(
        error.message.contains("/nonexistent/id_ed25519"),
        "{}",
        error.message
    );
}

/// A private `ssh-agent` holding the ed25519 test key, killed on drop.
struct Agent {
    child: Child,
    socket: PathBuf,
    _dir: tempfile::TempDir,
}

impl Agent {
    fn start(key: &str) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let socket = dir.path().join("agent.sock");
        let child = Command::new("ssh-agent")
            .arg("-D")
            .arg("-a")
            .arg(&socket)
            .spawn()
            .expect("ssh-agent");
        for _ in 0..100 {
            if socket.exists() {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        let added = Command::new("ssh-add")
            .arg("-q")
            .arg(key)
            .env("SSH_AUTH_SOCK", &socket)
            .status()
            .expect("ssh-add");
        assert!(added.success());
        Self {
            child,
            socket,
            _dir: dir,
        }
    }
}

impl Drop for Agent {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[tokio::test]
async fn the_agent_signs_for_its_keys() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let agent = Agent::start(&env.key("ed25519"));
    let (mut ctx, asked) = setup(&env, dir.path(), vec![], &[]).await;
    ctx.agent_socket = Some(agent.socket.clone());

    login(&env, &ctx, &target(&env, AuthPlan::Agent, None))
        .await
        .unwrap();
    assert!(prompts(&asked).is_empty());
}

#[tokio::test]
async fn no_agent_is_an_auth_error() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let (mut ctx, _) = setup(&env, dir.path(), vec![], &[]).await;
    ctx.agent_socket = None;

    let error = login(&env, &ctx, &target(&env, AuthPlan::Agent, None))
        .await
        .unwrap_err();
    assert_eq!(error.kind, ErrorKind::Auth);
}

#[tokio::test]
async fn the_auto_plan_falls_back_to_a_password_prompt() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let (ctx, asked) = setup(&env, dir.path(), vec![secret(&env.password(), true)], &[]).await;

    login(&env, &ctx, &target(&env, AuthPlan::Auto, None))
        .await
        .unwrap();
    assert!(matches!(
        prompts(&asked)[..],
        [PromptKind::Password {
            can_save: false,
            ..
        }]
    ));
}

#[tokio::test]
async fn keyboard_interactive_shows_each_real_question_once() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let answer = PromptAnswer::Responses {
        values: vec![SecretValue::new(env.password())],
    };
    let (ctx, asked) = setup(&env, dir.path(), vec![answer], &[]).await;
    let mut handle = connect(&env, &ctx, "target").await.unwrap();

    keyboard_interactive(&mut handle, &target(&env, AuthPlan::Password, None), &ctx)
        .await
        .unwrap();
    // PAM asks "Password: ", then sends an empty round: that one is answered without a dialog.
    assert_eq!(
        prompts(&asked),
        vec![PromptKind::KeyboardInteractive {
            connection_name: "target".into(),
            name: String::new(),
            instructions: String::new(),
            prompts: vec![InteractivePrompt {
                text: "Password: ".into(),
                echo: false,
            }],
        }]
    );
}

#[tokio::test]
async fn keyboard_interactive_rejects_a_wrong_number_of_answers() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let answer = PromptAnswer::Responses { values: vec![] };
    let (ctx, _) = setup(&env, dir.path(), vec![answer], &[]).await;
    let mut handle = connect(&env, &ctx, "target").await.unwrap();

    let error = keyboard_interactive(&mut handle, &target(&env, AuthPlan::Password, None), &ctx)
        .await
        .unwrap_err();
    assert_eq!(error.kind, ErrorKind::Validation);
}
