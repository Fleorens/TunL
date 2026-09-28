# T18 — Authentification SSH : mot de passe, clé + passphrase, agent, keyboard-interactive

| | |
|---|---|
| **Jalon** | M2 — SSH |
| **Dépend de** | T17 |
| **Lire avant** | `docs/06-securite.md` §2 (S1, S2, S3, S7, S8), `docs/05-modele-donnees.md` §7 |
| **Livrable** | Module `ssh/auth.rs` ; 2 tests Rust, 15 tests d'intégration contre podman |

## Pourquoi

Une fois la clé du serveur acceptée (T17), il faut prouver qui l'on est. TunL connaît trois méthodes enregistrées
(`SshAuth` : `Password`, `Key { path }`, `Agent`) et une quatrième pour la connexion rapide, qui n'a rien
d'enregistré (`Auto`). Les secrets viennent du trousseau (T12) ou d'un prompt, et ne sont enregistrés que si
l'utilisateur coche « mémoriser », **après** une authentification réussie.

Chaque appel russh a été prototypé contre les conteneurs de T16 : mot de passe, keyboard-interactive (PAM), clés
ed25519, RSA et chiffrée, agent. Les comportements notés ici sont ceux observés.

## À réutiliser (ne pas réécrire)

- `SshContext` (`ssh/mod.rs`) : `prompts` (`ask`), `secrets` (`get`, `set`), `agent_socket` ; `ClientHandler`,
  `map_russh_error` (T17) ; `SecretKind`, `SecretValue` (T12) ; `SshAuth` (`model`).
- Les tests d'intégration réutilisent `tests/support/mod.rs` (T17) **sans le modifier**.

## Contrat — Rust

### `src-tauri/src/ssh/auth.rs` (déclaré dans `ssh/mod.rs`, avec `#[cfg(test)] mod auth_tests;`)

```rust
pub const MAX_SECRET_ATTEMPTS: usize = 3;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthPlan { Password, Key { path: String }, Agent, Auto }

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthTarget {
    pub connection_id: Option<Uuid>,      // None for a quick connection: nothing can be saved
    pub connection_name: String,
    pub username: String,
    pub host: String,
    pub session_id: Option<Uuid>,
    pub plan: AuthPlan,
}

pub fn plan_for(auth: &SshAuth) -> AuthPlan;                          // Password → Password, Key{path} → Key{path}, Agent → Agent
pub fn expand_home(path: &str, home: Option<&Path>) -> PathBuf;        // "~" and "~/…" only
pub async fn authenticate(handle: &mut Handle<ClientHandler>, target: &AuthTarget, ctx: &SshContext) -> AppResult<()>;
pub async fn keyboard_interactive(handle: &mut Handle<ClientHandler>, target: &AuthTarget, ctx: &SshContext) -> AppResult<()>;
```

Le fichier dépassera sans doute 300 lignes : découpe-le si besoin en `ssh/auth.rs` (plan, `authenticate`, agent)
et `ssh/auth_secret.rs` (mot de passe, clé, keyboard-interactive), sans changer les chemins publics ci-dessus
(`pub use` dans `auth.rs`).

### Les méthodes

**Mot de passe** (`Password`, et la seconde moitié d'`Auto`) :
1. Candidat : si `connection_id` est `Some`, `ctx.secrets.get(id, SecretKind::Password)` (une erreur du trousseau →
   `log::warn!`, comme s'il n'y avait rien). Sinon, ou s'il a échoué : un prompt
   `Password { connection_name, username, host, can_save: connection_id.is_some(), retry }`, où `retry` est vrai dès
   qu'un essai précédent a échoué. Réponse `Secret { value, save }` ; `Cancel` (ou autre) → `ErrorKind::Cancelled`,
   `"authentication cancelled"`.
2. `handle.authenticate_password(username, value.expose())`.
   - `AuthResult::Success` → si `save` et `connection_id` : `ctx.secrets.set(id, connection_name, Password, &value)`
     (échec → `log::warn!`, l'authentification reste réussie). Fin.
   - `Failure { remaining_methods, .. }` sans `MethodKind::Password` mais avec `MethodKind::KeyboardInteractive`
     (`russh::MethodKind` ; `MethodSet` se déréférence en tranche : `remaining_methods.contains(&…)`) → le serveur
     n'accepte pas le mot de passe direct : passer à `keyboard_interactive`.
   - sinon, essai suivant. Le secret enregistré compte pour un essai.
3. Après `MAX_SECRET_ATTEMPTS` essais ratés → `ErrorKind::Auth`, `"authentication failed"`. Le trousseau n'est
   **jamais** modifié par un échec, ni par un succès sans `save`.

**Clé** (`Key { path }`) :
1. `path = expand_home(path, std::env::home_dir())`. `russh::keys::load_secret_key(&path, None)` :
   - `Ok(key)` → étape 3 ;
   - `Err(russh::keys::Error::KeyIsEncrypted)` → étape 2 ;
   - autre erreur → `ErrorKind::Auth`, `"cannot read key file <path as written>"` (jamais le contenu du fichier).
2. Passphrase : celle du trousseau (`SecretKind::Passphrase`), sinon un prompt
   `Passphrase { connection_name, key_path: <path as written>, can_save, retry }`. `load_secret_key(&path, Some(…))`
   en erreur = **mauvaise passphrase**, quelle que soit la variante (le prototype a reçu `SshKey(Crypto)`, pas
   `KeyIsEncrypted`) → nouveau prompt avec `retry: true`, `MAX_SECRET_ATTEMPTS` en tout. Sauvegarde : comme le mot
   de passe, après le succès de l'étape 3.
3. `let hash = handle.best_supported_rsa_hash().await?.flatten();` puis
   `handle.authenticate_publickey(username, PrivateKeyWithHashAlg::new(Arc::new(key), hash))`.
   `Success` → fin ; `Failure { partial_success: true, remaining_methods }` avec `KeyboardInteractive` → un second
   facteur est demandé : `keyboard_interactive` ; sinon → `ErrorKind::Auth`, `"the server refused the key"`.

**Agent** (`Agent`, et la première moitié d'`Auto`) :
- `ctx.agent_socket` absent → `ErrorKind::Auth`, `"no SSH agent (SSH_AUTH_SOCK is not set)"`.
- `AgentClient::connect_uds(socket)` (`russh::keys::agent::client::AgentClient`) ; échec → `Auth`,
  `"cannot reach the SSH agent"`. `agent.request_identities()` vide → `Auth`, `"the SSH agent has no keys"`.
- Pour chaque identité : `handle.authenticate_publickey_with(username, identity.public_key().into_owned(), hash,
  &mut agent)`. `Ok(Success)` → fin ; échec ou erreur → identité suivante (`log::debug!`) ; second facteur → comme
  pour la clé. Aucune n'a marché → `Auth`, `"the server refused every agent key"`.

**Auto** (connexion rapide) : l'agent s'il y en a un (`agent_socket` présent **et** au moins une identité ; toute
erreur de l'agent est ignorée), puis le mot de passe (`can_save` est faux : pas d'identifiant de connexion).

**Keyboard-interactive** (`keyboard_interactive`, public pour les tests) :
- `authenticate_keyboard_interactive_start(username, None)`, puis tant que la réponse est `InfoRequest` (dix tours
  au plus, sinon `Auth`) :
  - `prompts` **vide** → répondre `vec![]` sans rien demander à l'utilisateur. PAM (Debian) envoie un tel tour
    juste après le mot de passe : le prototype l'a vu ;
  - sinon un prompt `KeyboardInteractive { connection_name, name, instructions, prompts }`
    (`InteractivePrompt { text: p.prompt, echo: p.echo }`). Réponse `Responses { values }` : un nombre de valeurs
    différent du nombre de questions → `AppError::validation("values", "one answer per question")` ; `Cancel` →
    `Cancelled`. Répondre avec `authenticate_keyboard_interactive_respond(values exposées)`.
- `Success` → fin ; `Failure` → `Auth`, `"authentication failed"`.

Toute erreur russh pendant ces appels → `map_russh_error` (T17). Logs autorisés (S8) : la méthode, l'utilisateur,
l'hôte, le résultat. Jamais une valeur.

## Pièges (vus au prototype)

- Les `authenticate_*` de russh renvoient `Ok(AuthResult::Failure { .. })` pour un refus : ce n'est pas une `Err`.
- `authenticate_password` attend des `Into<String>` : passer `value.expose()` (une `&str`), jamais une copie gardée.
- sshd (Debian, PAM) fait attendre ~2 s après chaque mot de passe faux : le test des trois essais dure ~6 s, c'est normal.
- `std::env::set_var` est `unsafe` en Rust 2024 : l'agent se trouve par `ctx.agent_socket`, jamais en relisant
  `SSH_AUTH_SOCK` dans `auth.rs` (c'est `AppState::ssh_context` qui le lit, T17).

## Tests du contrat

### `src-tauri/src/ssh/auth_tests.rs`

```rust
use std::path::{Path, PathBuf};

use super::auth::{AuthPlan, expand_home, plan_for};
use crate::model::SshAuth;

#[test]
fn each_saved_method_has_its_plan() {
    assert_eq!(plan_for(&SshAuth::Password), AuthPlan::Password);
    assert_eq!(plan_for(&SshAuth::Agent), AuthPlan::Agent);
    assert_eq!(
        plan_for(&SshAuth::Key {
            path: "~/.ssh/id_ed25519".into()
        }),
        AuthPlan::Key {
            path: "~/.ssh/id_ed25519".into()
        }
    );
}

#[test]
fn a_leading_tilde_is_the_home_directory() {
    let home = Some(Path::new("/home/ada"));
    assert_eq!(
        expand_home("~/.ssh/id_ed25519", home),
        PathBuf::from("/home/ada/.ssh/id_ed25519")
    );
    assert_eq!(expand_home("~", home), PathBuf::from("/home/ada"));
    assert_eq!(expand_home("/etc/key", home), PathBuf::from("/etc/key"));
    // Only a leading `~/` (or `~` alone) is expanded: `~bob` and a `~` inside the path stay as written.
    assert_eq!(expand_home("~bob/key", home), PathBuf::from("~bob/key"));
    assert_eq!(expand_home("/keys/~/id", home), PathBuf::from("/keys/~/id"));
    // Without a home directory, the path stays as written.
    assert_eq!(expand_home("~/.ssh/id", None), PathBuf::from("~/.ssh/id"));
}
```

### `src-tauri/tests/ssh_auth.rs` (contre podman : `npm run test:ssh`)

```rust
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
```


## Étapes

1. Les tests : `node scripts/contract-tests.mjs T18`.
2. `plan_for`, `expand_home`, puis `cargo test ssh::auth`.
3. Mot de passe et keyboard-interactive, puis `npm run test:ssh` (les tests de clé et d'agent échouent encore).
4. Clé et passphrase, agent, `Auto`, jusqu'à ce que `npm run test:ssh` soit vert.
5. `npm run format`, `npm run review`, cases, statut, commit `feat: SSH authentication with keyring secrets and prompts (T18)`.

## Critères d'acceptation

- [ ] `npm run review` passe, et `node scripts/contract-tests.mjs T18 --check` affiche `OK` partout.
- [ ] `grep -rn "expose()" src-tauri/src/ssh` ne montre que des passages directs à russh ou au trousseau (aucun
      `format!`, aucun log).

## À regarder par Florian

Toujours rien à l'écran (T21). `npm run test:ssh` : les quinze scénarios d'authentification contre les conteneurs.
