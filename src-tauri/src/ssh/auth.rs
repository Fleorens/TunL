//! SSH authentication methods: the plan, the public entry point, and the agent (T18).
//!
//! The password, private key, and keyboard-interactive flows live in `auth_secret.rs`; this module
//! only holds the plan, the target, the home expansion, the dispatcher, and the agent. The public
//! `authenticate` and `keyboard_interactive` are re-exported from `auth_secret.rs` (docs/06, S7, S8).
use std::path::{Path, PathBuf};

use russh::client::Handle;
use russh::keys::agent::client::AgentClient;
use uuid::Uuid;

use super::auth_secret;
use crate::error::{AppError, AppResult, ErrorKind};
use crate::model::SshAuth;
use crate::ssh::SshContext;
use crate::ssh::handler::ClientHandler;

/// How many times a single secret (stored or prompted) is tried before giving up.
pub const MAX_SECRET_ATTEMPTS: usize = 3;

/// What this connection will try to authenticate with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthPlan {
    Password,
    Key {
        path: String,
    },
    Agent,
    /// Quick connection: the agent if there is one, else a password (nothing can be saved).
    Auto,
}

/// Everything `authenticate` needs about this connection besides the handle.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthTarget {
    pub connection_id: Option<Uuid>,
    pub connection_name: String,
    pub username: String,
    pub host: String,
    pub session_id: Option<Uuid>,
    pub plan: AuthPlan,
}

/// The plan a saved [`SshAuth`] maps to.
pub fn plan_for(auth: &SshAuth) -> AuthPlan {
    match auth {
        SshAuth::Password => AuthPlan::Password,
        SshAuth::Agent => AuthPlan::Agent,
        SshAuth::Key { path } => AuthPlan::Key { path: path.clone() },
    }
}

/// Expand a leading `~` (or a bare `~`) to `home`; leave every other path as written.
///
/// Only a leading `~/` (or `~` alone) is expanded: `~bob` and a `~` inside the path stay as written
/// (docs/06-securite.md, S7: the path is shown to the user, so it must be the one they typed).
pub fn expand_home(path: &str, home: Option<&Path>) -> PathBuf {
    match path {
        "~" => home
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(path)),
        head if head.starts_with("~/") => home
            .map(|home| {
                let mut buf = home.to_path_buf();
                buf.push(&head["~/".len()..]);
                buf
            })
            .unwrap_or_else(|| PathBuf::from(path)),
        _ => PathBuf::from(path),
    }
}

/// Authenticate `target` with its plan.
pub async fn authenticate(
    handle: &mut Handle<ClientHandler>,
    target: &AuthTarget,
    ctx: &SshContext,
) -> AppResult<()> {
    match &target.plan {
        AuthPlan::Password => auth_secret::authenticate_password(handle, target, ctx).await,
        AuthPlan::Key { path } => auth_secret::authenticate_key(handle, path, target, ctx).await,
        AuthPlan::Agent => authenticate_agent(handle, target, ctx).await,
        AuthPlan::Auto => authenticate_auto(handle, target, ctx).await,
    }
}

/// The agent: connect, try every identity, fail with a clear message when none is usable.
async fn authenticate_agent(
    handle: &mut Handle<ClientHandler>,
    target: &AuthTarget,
    ctx: &SshContext,
) -> AppResult<()> {
    let socket = match &ctx.agent_socket {
        Some(socket) => socket.clone(),
        None => {
            return Err(AppError::new(
                ErrorKind::Auth,
                "no SSH agent (SSH_AUTH_SOCK is not set)",
            ));
        }
    };
    let mut agent = AgentClient::connect_uds(&socket)
        .await
        .map_err(|_| AppError::new(ErrorKind::Auth, "cannot reach the SSH agent"))?;
    let identities = match agent.request_identities().await {
        Ok(identities) => identities,
        Err(_) => return Err(AppError::new(ErrorKind::Auth, "cannot reach the SSH agent")),
    };
    if identities.is_empty() {
        return Err(AppError::new(ErrorKind::Auth, "the SSH agent has no keys"));
    }
    for identity in identities {
        if auth_secret::agent_sign_one(handle, &mut agent, target, ctx, &identity).await? {
            return Ok(());
        }
    }
    Err(AppError::new(
        ErrorKind::Auth,
        "the server refused every agent key",
    ))
}

/// The quick connection: the agent if there is one (socket present and at least one identity, any
/// agent error ignored), else a password that cannot be saved (no connection id).
async fn authenticate_auto(
    handle: &mut Handle<ClientHandler>,
    target: &AuthTarget,
    ctx: &SshContext,
) -> AppResult<()> {
    if let Some(socket) = &ctx.agent_socket
        && auth_secret::agent_signs(handle, socket, target, ctx).await
    {
        return Ok(());
    }
    auth_secret::authenticate_password(handle, target, ctx).await
}

pub use auth_secret::keyboard_interactive;
