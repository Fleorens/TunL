//! The four commands that drive a shell session from the UI (T19).
//!
//! `ssh_open` starts a session in the background and answers at once; `ssh_write`, `ssh_resize` and
//! `session_close` talk to the running task through the registry. Each session reports through the two
//! `Channel`s passed at open time (see docs/01-architecture.md §6).
use std::sync::Arc;

use tauri::State;
use tauri::ipc::{Channel, InvokeResponseBody};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::error::AppResult;
use crate::sessions::{SessionEvent, SessionHandle, SessionSink, ShellInput};
use crate::ssh::session::{SessionTarget, default_username, resolve_target, run_ssh_session};
use crate::ssh::shell::validate_size;
use crate::state::AppState;
use crate::wol::{WAKE_POLL_INTERVAL, run_wake_step, wake_target};

/// Open a shell session against a saved connection or a quick target (docs/01-architecture.md §6).
///
/// Validates the size and resolves the target before anything starts (these errors are returned, with
/// no task spawned), registers the session, then spawns the task and answers at once.
#[tauri::command]
pub async fn ssh_open(
    state: State<'_, AppState>,
    session_id: Uuid,
    target: SessionTarget,
    cols: u32,
    rows: u32,
    on_event: Channel<SessionEvent>,
    on_output: Channel<InvokeResponseBody>,
) -> AppResult<()> {
    validate_size(cols, rows)?;

    let settings = state.get_settings().await;
    let store = state.read_store().await?;
    let resolved_target = resolve_target(
        &target,
        &store,
        &settings.ssh,
        default_username().as_deref(),
    )?;

    // A direct connection that asked to be woken first: send its packet before connecting (T29). Behind
    // a bastion this is `None` (see `wake_target`), and a quick target never is.
    let wake = match &target {
        SessionTarget::Saved { connection_id } => store
            .connections
            .iter()
            .find(|connection| connection.id == *connection_id)
            .and_then(wake_target),
        SessionTarget::Quick { .. } => None,
    };

    // The session's input channel and cancel token, so the UI can write to it and end it.
    let (input, output) = mpsc::unbounded_channel::<ShellInput>();
    let cancel = CancellationToken::new();
    state.sessions.insert(
        session_id,
        SessionHandle {
            cancel: cancel.clone(),
            input,
        },
    )?;

    // Everything the spawned task needs, cloned out of `state` before the command returns.
    let sessions = state.sessions.clone();
    let prompts = state.prompts.clone();
    let ctx = state.ssh_context();
    // One sink for the wake step and the session, so both report through the same two channels.
    let sink: Arc<dyn SessionSink> = Arc::new(TauriSessionSink {
        on_event,
        on_output,
    });

    tauri::async_runtime::spawn(async move {
        // Wake first, and only connect when it finished (a failure or a closed tab stops here). The
        // cleanup below runs in every case.
        let mut connect = true;
        if let Some(wake) = wake
            && !run_wake_step(&wake, WAKE_POLL_INTERVAL, cancel.clone(), &*sink).await
        {
            connect = false;
        }
        if connect {
            let session = crate::ssh::session::ShellSession {
                id: session_id,
                target: resolved_target,
                cols,
                rows,
                input: output,
                cancel,
            };
            run_ssh_session(ctx, session, Arc::clone(&sink)).await;
        }
        sessions.remove(session_id);
        prompts.cancel_session(session_id);
    });

    Ok(())
}

/// Write bytes to a session (keystrokes). An unknown session is `not_found`.
#[tauri::command]
pub async fn ssh_write(
    state: State<'_, AppState>,
    session_id: Uuid,
    data: String,
) -> AppResult<()> {
    state
        .sessions
        .send(session_id, ShellInput::Data(data.into_bytes()))
}

/// Resize a session's terminal. The size is validated before the resize is sent.
#[tauri::command]
pub async fn ssh_resize(
    state: State<'_, AppState>,
    session_id: Uuid,
    cols: u32,
    rows: u32,
) -> AppResult<()> {
    validate_size(cols, rows)?;
    state
        .sessions
        .send(session_id, ShellInput::Resize { cols, rows })
}

/// End a session: cancel its task and forget it, then drop its pending prompts. Idempotent.
#[tauri::command]
pub async fn session_close(state: State<'_, AppState>, session_id: Uuid) -> AppResult<()> {
    state.sessions.close(session_id);
    state.prompts.cancel_session(session_id);
    Ok(())
}

/// A session's sink on the Tauri side: its events and its bytes go out through the two `Channel`s
/// passed at open time. A send that fails (the window closed) is logged, never panicked.
struct TauriSessionSink {
    on_event: Channel<SessionEvent>,
    on_output: Channel<InvokeResponseBody>,
}

impl SessionSink for TauriSessionSink {
    fn event(&self, event: SessionEvent) {
        if self.on_event.send(event).is_err() {
            log::debug!("session events channel closed");
        }
    }

    fn output(&self, bytes: Vec<u8>) {
        if self.on_output.send(InvokeResponseBody::Raw(bytes)).is_err() {
            log::debug!("session output channel closed");
        }
    }
}
