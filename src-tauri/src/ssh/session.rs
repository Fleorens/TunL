//! What a shell session connects to, and the steps that connect it (T19).
//!
//! `resolve_target` turns a `SessionTarget` (a saved connection, or a quick host) into the address,
//! user and auth plan a connection needs. `run_ssh_session` runs the steps and the shell (shell.rs).
use std::sync::Arc;
use std::time::Duration;

use russh::Disconnect;
use russh::client::Handle;
use serde::Deserialize;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use ts_rs::TS;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::model::{
    Connection, ConnectionInput, Protocol, ProtocolSettings, SshDefaults, SshSettings,
    normalize_connection_input,
};
use crate::sessions::{CloseReason, SessionEvent, SessionSink, ShellInput, StepKind, StepState};
use crate::ssh::auth::{AuthPlan, authenticate, plan_for};
use crate::ssh::chain::{auth_target_of, connect_hop, dial, handshake_with, resolve_chain};
use crate::ssh::shell::{open_shell, pump};
use crate::ssh::{SshContext, handler::ClientHandler};
use crate::store::Store;

/// A shell session opens against a saved connection or a quick target typed in the UI (docs/01 §6).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum SessionTarget {
    Saved {
        connection_id: Uuid,
    },
    Quick {
        host: String,
        port: u16,
        username: Option<String>,
    },
}

/// Everything `run_ssh_session` learns about a target before connecting.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SshTarget {
    pub connection_id: Option<Uuid>,
    pub connection_name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub plan: AuthPlan,
    pub connect_timeout: Duration,
    pub keepalive_secs: u32,
    /// The bastions to cross, first dialled first (T22). Empty for a direct connection, and always empty in
    /// the `SshTarget` of a bastion.
    pub jump_hosts: Vec<SshTarget>,
}

/// One running session, handed to `run_ssh_session`. The input receiver and cancel token come from the
/// registry (commands/ssh.rs) so the UI can write to it and end it.
#[derive(Debug)]
pub struct ShellSession {
    pub id: Uuid,
    pub target: SshTarget,
    pub cols: u32,
    pub rows: u32,
    pub input: mpsc::UnboundedReceiver<ShellInput>,
    pub cancel: CancellationToken,
}

/// The user to connect as when nothing else says: `$USER`, else `$LOGNAME` (non-empty).
pub fn default_username() -> Option<String> {
    std::env::var("USER")
        .ok()
        .filter(|user| !user.is_empty())
        .or_else(|| {
            std::env::var("LOGNAME")
                .ok()
                .filter(|user| !user.is_empty())
        })
}

/// Resolve what a shell session connects to (docs/01-architecture.md §5, this sheet): the address, user and
/// auth plan of the target, and the bastions to cross before it (T22).
pub fn resolve_target(
    target: &SessionTarget,
    store: &Store,
    defaults: &SshDefaults,
    default_user: Option<&str>,
) -> AppResult<SshTarget> {
    match target {
        SessionTarget::Saved { connection_id } => {
            let connection = store
                .connections
                .iter()
                .find(|c| c.id == *connection_id)
                .ok_or_else(|| AppError::not_found(format!("connection {connection_id}")))?;
            // The bastions first, each with its own settings (T22); the target keeps them in `jump_hosts`.
            let chain = resolve_chain(connection, &store.connections)?;
            let jump_hosts: Vec<SshTarget> = chain
                .iter()
                .map(|hop| saved_target(hop, defaults, default_user))
                .collect::<AppResult<_>>()?;
            let mut target = saved_target(connection, defaults, default_user)?;
            target.jump_hosts = jump_hosts;
            Ok(target)
        }
        SessionTarget::Quick {
            host,
            port,
            username,
        } => {
            // Validate exactly as a connection would: name (= host), host, port, jump chain.
            let input = ConnectionInput {
                name: host.clone(),
                host: host.clone(),
                port: *port,
                username: username.clone(),
                settings: ProtocolSettings::Ssh(SshSettings::default()),
                ..ConnectionInput::template(Protocol::Ssh)
            };
            let input =
                normalize_connection_input(&input, None, &store.groups, &store.connections)?;
            let username = username_of(&input.username, default_user)?;
            let connection_name = match input.username.as_deref().filter(|u| !u.is_empty()) {
                Some(user) => format!("{user}@{}", input.host),
                None => input.host.clone(),
            };
            Ok(SshTarget {
                connection_id: None,
                connection_name,
                host: input.host,
                port: input.port,
                username,
                plan: AuthPlan::Auto,
                connect_timeout: connect_timeout(None, defaults.connect_timeout_secs),
                keepalive_secs: defaults.keepalive_secs,
                jump_hosts: Vec::new(),
            })
        }
    }
}

/// What a saved connection connects to: its SSH protocol, user, auth plan and delays (T22). The bastions are
/// filled by `resolve_target`, so this always resolves a direct target with an empty `jump_hosts`.
fn saved_target(
    connection: &Connection,
    defaults: &SshDefaults,
    default_user: Option<&str>,
) -> AppResult<SshTarget> {
    let ProtocolSettings::Ssh(settings) = &connection.settings else {
        return Err(AppError::validation("protocol", "is not SSH"));
    };
    let SshSettings {
        auth,
        keepalive_secs,
        connect_timeout_secs,
        ..
    } = settings.clone();
    let username = username_of(&connection.username, default_user)?;
    Ok(SshTarget {
        connection_id: Some(connection.id),
        connection_name: connection.name.clone(),
        host: connection.host.clone(),
        port: connection.port,
        username,
        plan: plan_for(&auth),
        connect_timeout: connect_timeout(connect_timeout_secs, defaults.connect_timeout_secs),
        keepalive_secs: keepalive_secs.unwrap_or(defaults.keepalive_secs),
        jump_hosts: Vec::new(),
    })
}

/// The connection's own user, else `default_user`, else a validation error (docs/01-architecture.md §5).
fn username_of(connection: &Option<String>, default_user: Option<&str>) -> AppResult<String> {
    connection
        .as_deref()
        .or(default_user)
        .filter(|user| !user.is_empty())
        .map(str::to_string)
        .ok_or_else(|| AppError::validation("username", "is required"))
}

/// A connection's own timeout, or the global default when it leaves it unset.
fn connect_timeout(connect_timeout_secs: Option<u32>, default_secs: u32) -> Duration {
    Duration::from_secs(u64::from(connect_timeout_secs.unwrap_or(default_secs)))
}

/// Run one shell session: the steps, the shell, and the end (docs/01-architecture.md §5, §6).
///
/// Before the target, one `Hop` step crosses each bastion (first dialled first, T22): its stream, its
/// handshake, then its authentication. Each step then emits `Started` then `Done` or `Failed`. A failed step
/// emits `Error` and stops, with no `Closed`. A cancel during any step stops with `Closed { UserClosed, None }`
/// (the prompt it left behind is forgotten by the broker when its future is dropped). When the shell ends,
/// `Closed { reason, exit_status }` is emitted, then a clean disconnect of the target and, after it, of the
/// bastions from the nearest to the first.
pub async fn run_ssh_session(ctx: SshContext, session: ShellSession, sink: Arc<dyn SessionSink>) {
    let ShellSession {
        id,
        target,
        cols,
        rows,
        input,
        cancel,
    } = session;

    // The bastions before the target, kept alive until the end of the session (a dropped handle would close
    // the target's channel). One Hop step crosses each of them, first dialled first (T22): the stream, the
    // handshake, then authentication with the bastion's own plan.
    let mut handles: Vec<Handle<ClientHandler>> = Vec::new();
    let mut names: Vec<String> = Vec::new();
    for hop in &target.jump_hosts {
        // The channel is opened through the bastion before this one (the previous handle), named `via` in
        // errors; empty for the first, opened by TCP.
        let via_name = names.last().cloned().unwrap_or_default();
        let Ok(hop_handle) = connect_step(
            cancel.clone(),
            &*sink,
            StepKind::Hop,
            &hop.connection_name,
            || async {
                let mut handle = connect_hop(hop, handles.last(), &via_name, id, &ctx).await?;
                authenticate(&mut handle, &auth_target_of(hop, id), &ctx).await?;
                Ok(handle)
            },
        )
        .await
        else {
            return;
        };
        handles.push(hop_handle);
        names.push(hop.connection_name.clone());
    }

    // Target: through the last bastion, or by TCP when there is none.
    let address = format!("{}:{}", target.host, target.port);
    let via_name = names.last().cloned().unwrap_or_default();
    let Ok(stream) = connect_step(cancel.clone(), &*sink, StepKind::Target, &address, || {
        dial(handles.last(), &via_name, &target, target.connect_timeout)
    })
    .await
    else {
        return;
    };

    // Host key: russh negotiates the session and checks the server's key.
    let Ok(mut handle) = connect_step(
        cancel.clone(),
        &*sink,
        StepKind::HostKey,
        &target.host,
        || handshake_with(stream, &target, id, &ctx),
    )
    .await
    else {
        return;
    };

    // Authentication.
    let auth_target = auth_target_of(&target, id);
    let Ok(()) = connect_step(
        cancel.clone(),
        &*sink,
        StepKind::Auth,
        &target.username,
        || authenticate(&mut handle, &auth_target, &ctx),
    )
    .await
    else {
        return;
    };

    // Open the shell on its PTY.
    let Ok(channel) = connect_step(cancel.clone(), &*sink, StepKind::Open, "shell", || {
        open_shell(&handle, cols, rows)
    })
    .await
    else {
        return;
    };

    // The shell runs until it ends, then we disconnect cleanly: the target first, then the bastions from the
    // nearest to the first (their handles, still alive, close the channels they hold open).
    sink.event(SessionEvent::Connected);
    let (reason, exit_status) = pump(channel, input, cancel.clone(), &*sink).await;
    sink.event(SessionEvent::Closed {
        reason,
        exit_status,
    });
    let _ = handle.disconnect(Disconnect::ByApplication, "", "en").await;
    for handle in handles.into_iter().rev() {
        let _ = handle.disconnect(Disconnect::ByApplication, "", "en").await;
    }
}

/// Run one step's work, emitting `Started`, then `Done` (and returning the value) or `Failed` +
/// `Error`. A cancel stops with `Closed { UserClosed, None }`, reported as `Err(())`. Each `await`
/// inside `work` is cancelable (docs/01 §6): dropping the step future on cancel lets a pending prompt
/// forget itself (T17).
pub(crate) async fn connect_step<F, Fut, T>(
    cancel: CancellationToken,
    sink: &dyn SessionSink,
    step: StepKind,
    label: &str,
    work: F,
) -> Result<T, ()>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = AppResult<T>>,
{
    sink.event(SessionEvent::Step {
        step,
        label: label.to_string(),
        state: StepState::Started,
    });
    tokio::select! {
        _ = cancel.cancelled() => {
            sink.event(SessionEvent::Closed {
                reason: CloseReason::UserClosed,
                exit_status: None,
            });
            Err(())
        }
        result = work() => match result {
            Ok(value) => {
                sink.event(SessionEvent::Step {
                    step,
                    label: label.to_string(),
                    state: StepState::Done,
                });
                Ok(value)
            }
            Err(error) => {
                sink.event(SessionEvent::Step {
                    step,
                    label: label.to_string(),
                    state: StepState::Failed,
                });
                sink.event(SessionEvent::Error { error });
                Err(())
            }
        }
    }
}
