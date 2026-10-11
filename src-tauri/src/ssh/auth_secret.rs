//! The password, private key, and keyboard-interactive authentication flows (T18).
//!
//! Secrets come from the keyring or a prompt and are only written back after a success (docs/06, S1,
//! S2, S3, S7, S8). Russh reports a refusal as `Ok(AuthResult::Failure { .. })`, never an `Err`: every
//! real `Err` is routed through `map_russh_error`.
use std::path::Path;
use std::sync::Arc;

use russh::MethodKind;
use russh::client::{AuthResult, Handle, KeyboardInteractiveAuthResponse};
use russh::keys::agent::AgentIdentity;
use russh::keys::agent::client::AgentClient;
use russh::keys::{PrivateKeyWithHashAlg, PublicKey, load_secret_key};

use crate::error::{AppError, AppResult, ErrorKind};
use crate::prompts::{InteractivePrompt, PromptAnswer, PromptKind};
use crate::secrets::{SecretKind, SecretValue};
use crate::ssh::SshContext;
use crate::ssh::auth::{AuthTarget, MAX_SECRET_ATTEMPTS, expand_home};
use crate::ssh::error::map_russh_error;
use crate::ssh::handler::ClientHandler;

/// Max keyboard-interactive rounds before giving up (docs/06-securite.md, T18: ten at most).
const KB_INTERACTIVE_MAX_ROUNDS: usize = 10;

/// Ask for a password, returning the value and whether it should be saved. A non-secret answer
/// (Cancel, or anything unexpected) is a cancellation (S7: no secret leaks into the error).
async fn prompt_password(
    target: &AuthTarget,
    ctx: &SshContext,
    retry: bool,
) -> AppResult<(SecretValue, bool)> {
    match ctx
        .prompts
        .ask(
            target.session_id,
            PromptKind::Password {
                connection_name: target.connection_name.clone(),
                username: target.username.clone(),
                host: target.host.clone(),
                can_save: target.connection_id.is_some(),
                retry,
            },
        )
        .await?
    {
        PromptAnswer::Secret { value, save } => Ok((value, save)),
        _ => Err(AppError::new(
            ErrorKind::Cancelled,
            "authentication cancelled",
        )),
    }
}

/// Ask for a key passphrase, with the key path as the user typed it (S7).
async fn prompt_passphrase(
    target: &AuthTarget,
    ctx: &SshContext,
    written: &str,
    retry: bool,
) -> AppResult<(SecretValue, bool)> {
    match ctx
        .prompts
        .ask(
            target.session_id,
            PromptKind::Passphrase {
                connection_name: target.connection_name.clone(),
                key_path: written.to_string(),
                can_save: target.connection_id.is_some(),
                retry,
            },
        )
        .await?
    {
        PromptAnswer::Secret { value, save } => Ok((value, save)),
        _ => Err(AppError::new(
            ErrorKind::Cancelled,
            "authentication cancelled",
        )),
    }
}

/// Write a secret after a success, logging (never failing) on a keyring error (S8).
async fn save_secret(ctx: &SshContext, target: &AuthTarget, kind: SecretKind, value: &SecretValue) {
    if let Some(id) = target.connection_id
        && let Err(error) = ctx
            .secrets
            .set(id, &target.connection_name, kind, value)
            .await
    {
        log::warn!(
            "cannot store {} for {}: {error}",
            kind.as_str(),
            target.connection_name
        );
    }
}
/// The stored value on the first try, else a prompt. A keyring read error is treated as "nothing
/// stored" (docs/06, S7): ask the user. The stored secret counts for exactly one attempt.
async fn candidate(
    target: &AuthTarget,
    ctx: &SshContext,
    kind: SecretKind,
    retry: bool,
    written: &str,
    try_stored: bool,
) -> AppResult<(SecretValue, bool)> {
    if try_stored && let Some(id) = target.connection_id {
        match ctx.secrets.get(id, kind).await {
            Ok(Some(secret)) => return Ok((secret, false)),
            Ok(None) => {}
            Err(error) => {
                log::warn!(
                    "cannot read stored {} for {}: {error}",
                    kind.as_str(),
                    target.connection_name
                );
            }
        }
    }
    match kind {
        SecretKind::Password => prompt_password(target, ctx, retry).await,
        SecretKind::Passphrase => prompt_passphrase(target, ctx, written, retry).await,
    }
}

/// Password, and the second half of `Auto` (docs/06, S7, S8).
pub async fn authenticate_password(
    handle: &mut Handle<ClientHandler>,
    target: &AuthTarget,
    ctx: &SshContext,
) -> AppResult<()> {
    let mut attempts = 0;
    loop {
        let retry = attempts > 0;
        let (value, save) =
            candidate(target, ctx, SecretKind::Password, retry, "", attempts == 0).await?;
        attempts += 1;

        match handle
            .authenticate_password(target.username.clone(), value.expose())
            .await
            .map_err(|e| map_russh_error(&e))?
        {
            AuthResult::Success => {
                if save {
                    save_secret(ctx, target, SecretKind::Password, &value).await;
                }
                return Ok(());
            }
            AuthResult::Failure {
                remaining_methods, ..
            } => {
                // The server does not accept a direct password: fall back to keyboard-interactive.
                if !remaining_methods.contains(&MethodKind::Password)
                    && remaining_methods.contains(&MethodKind::KeyboardInteractive)
                {
                    return keyboard_interactive(handle, target, ctx).await;
                }
                if attempts >= MAX_SECRET_ATTEMPTS {
                    return Err(AppError::new(ErrorKind::Auth, "authentication failed"));
                }
            }
        }
    }
}

/// The public-key step shared by `Key` and the agent: load the hash, offer the key, fall back to a
/// second factor when the server asks for one.
async fn offer_key(
    handle: &mut Handle<ClientHandler>,
    key: russh::keys::PrivateKey,
    target: &AuthTarget,
    ctx: &SshContext,
) -> AppResult<bool> {
    let hash = handle
        .best_supported_rsa_hash()
        .await
        .map_err(|e| map_russh_error(&e))?
        .flatten();
    match handle
        .authenticate_publickey(
            target.username.clone(),
            PrivateKeyWithHashAlg::new(Arc::new(key), hash),
        )
        .await
        .map_err(|e| map_russh_error(&e))?
    {
        AuthResult::Success => Ok(true),
        AuthResult::Failure {
            partial_success: true,
            remaining_methods,
        } if remaining_methods.contains(&MethodKind::KeyboardInteractive) => {
            keyboard_interactive(handle, target, ctx).await?;
            Ok(true)
        }
        _ => Err(AppError::new(ErrorKind::Auth, "the server refused the key")),
    }
}

/// The private key, with its passphrase when the file is encrypted (docs/06, S7, S8).
pub async fn authenticate_key(
    handle: &mut Handle<ClientHandler>,
    path: &str,
    target: &AuthTarget,
    ctx: &SshContext,
) -> AppResult<()> {
    let expanded = expand_home(path, std::env::home_dir().as_deref());
    let written = path.to_string();
    match load_secret_key(&expanded, None) {
        Ok(key) => {
            offer_key(handle, key, target, ctx).await?;
            return Ok(());
        }
        Err(russh::keys::Error::KeyIsEncrypted) => {}
        Err(error) => {
            log::debug!("cannot read key file {written}: {error}");
            return Err(AppError::new(
                ErrorKind::Auth,
                format!("cannot read key file {written}"),
            ));
        }
    }

    // The key is encrypted: try the keyring, then prompts, up to MAX_SECRET_ATTEMPTS in all.
    for attempt in 1..=MAX_SECRET_ATTEMPTS {
        let (passphrase, save) = candidate(
            target,
            ctx,
            SecretKind::Passphrase,
            attempt > 1,
            &written,
            attempt == 1,
        )
        .await?;
        if let Ok(key) = load_secret_key(&expanded, Some(passphrase.expose())) {
            offer_key(handle, key, target, ctx).await?;
            if save {
                save_secret(ctx, target, SecretKind::Passphrase, &passphrase).await;
            }
            return Ok(());
        }
        // Any load error is a wrong passphrase (the prototype got `SshKey(Crypto)`, not
        // `KeyIsEncrypted`). Ask again, unless this was the last attempt.
    }
    Err(AppError::new(ErrorKind::Auth, "authentication failed"))
}

/// Try one agent identity. Returns whether it authenticated (including a second factor).
pub(crate) async fn agent_sign_one(
    handle: &mut Handle<ClientHandler>,
    agent: &mut AgentClient<tokio::net::UnixStream>,
    target: &AuthTarget,
    ctx: &SshContext,
    identity: &AgentIdentity,
) -> AppResult<bool> {
    let public_key: PublicKey = identity.public_key().into_owned();
    let hash = handle
        .best_supported_rsa_hash()
        .await
        .map_err(|e| map_russh_error(&e))?
        .flatten();
    match handle
        .authenticate_publickey_with(target.username.clone(), public_key, hash, agent)
        .await
    {
        Ok(AuthResult::Success) => Ok(true),
        Ok(AuthResult::Failure {
            partial_success: true,
            remaining_methods,
        }) if remaining_methods.contains(&MethodKind::KeyboardInteractive) => {
            keyboard_interactive(handle, target, ctx)
                .await
                .map(|()| true)
        }
        Ok(_) => {
            log::debug!("agent key refused by the server");
            Ok(false)
        }
        Err(error) => {
            log::debug!("agent key signing failed: {error}");
            Ok(false)
        }
    }
}

/// Connect the agent and try every identity, ignoring every agent error (the quick connection).
pub(crate) async fn agent_signs(
    handle: &mut Handle<ClientHandler>,
    socket: &Path,
    target: &AuthTarget,
    ctx: &SshContext,
) -> bool {
    let mut agent = match AgentClient::connect_uds(socket).await {
        Ok(agent) => agent,
        Err(_) => return false,
    };
    let identities = match agent.request_identities().await {
        Ok(identities) => identities,
        Err(_) => return false,
    };
    if identities.is_empty() {
        return false;
    }
    for identity in identities {
        if matches!(
            agent_sign_one(handle, &mut agent, target, ctx, &identity).await,
            Ok(true)
        ) {
            return true;
        }
    }
    false
}

/// Keyboard-interactive (PAM, OTP…): each real question once, empty rounds answered without asking
/// (docs/06, S7, S8). Public for the tests.
pub async fn keyboard_interactive(
    handle: &mut Handle<ClientHandler>,
    target: &AuthTarget,
    ctx: &SshContext,
) -> AppResult<()> {
    let mut response = handle
        .authenticate_keyboard_interactive_start(target.username.clone(), None)
        .await
        .map_err(|e| map_russh_error(&e))?;
    let mut rounds = 0;
    loop {
        let (name, instructions, prompts) = match response {
            KeyboardInteractiveAuthResponse::Success => return Ok(()),
            KeyboardInteractiveAuthResponse::Failure { .. } => {
                return Err(AppError::new(ErrorKind::Auth, "authentication failed"));
            }
            KeyboardInteractiveAuthResponse::InfoRequest {
                name,
                instructions,
                prompts,
            } => (name, instructions, prompts),
        };
        rounds += 1;
        if rounds > KB_INTERACTIVE_MAX_ROUNDS {
            return Err(AppError::new(ErrorKind::Auth, "authentication failed"));
        }
        if prompts.is_empty() {
            // A PAM round with no question: answer with nothing, without asking the user.
            response = handle
                .authenticate_keyboard_interactive_respond(vec![])
                .await
                .map_err(|e| map_russh_error(&e))?;
            continue;
        }
        let answer = ctx
            .prompts
            .ask(
                target.session_id,
                PromptKind::KeyboardInteractive {
                    connection_name: target.connection_name.clone(),
                    name,
                    instructions,
                    prompts: prompts
                        .iter()
                        .map(|p| InteractivePrompt {
                            text: p.prompt.clone(),
                            echo: p.echo,
                        })
                        .collect(),
                },
            )
            .await?;
        let values = match answer {
            PromptAnswer::Responses { values } => values,
            _ => {
                return Err(AppError::new(
                    ErrorKind::Cancelled,
                    "authentication cancelled",
                ));
            }
        };
        if values.len() != prompts.len() {
            return Err(AppError::validation("values", "one answer per question"));
        }
        response = handle
            .authenticate_keyboard_interactive_respond(
                values
                    .iter()
                    .map(|value| value.expose().to_string())
                    .collect(),
            )
            .await
            .map_err(|e| map_russh_error(&e))?;
    }
}
