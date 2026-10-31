//! The eight commands that drive an SFTP tab from the UI (T24).
//!
//! `sftp_open` starts a tab in the background and answers at once (like `ssh_open`); the other seven
//! talk to the running session through `state.sftp`. Each tab reports its steps and its end through one
//! `Channel` (docs/01-architecture.md §6).
use std::sync::Arc;

use tauri::State;
use tauri::ipc::Channel;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::error::AppResult;
use crate::sessions::{SessionEvent, SessionHandle, SessionSink};
use crate::sftp::RemoteEntry;
use crate::sftp::ops;
use crate::sftp::session::{SftpRun, run_sftp_session};
use crate::ssh::session::{SessionTarget, default_username, resolve_target};
use crate::state::AppState;
use crate::wol::{WAKE_POLL_INTERVAL, run_wake_step, wake_target};

/// Open an SFTP tab against a saved connection or a quick target (docs/01-architecture.md §6).
///
/// Resolves and (for a direct connection) wakes the target before anything starts — those errors are
/// returned, with no task spawned — registers the tab, then spawns the task and answers at once.
#[tauri::command]
pub async fn sftp_open(
    state: State<'_, AppState>,
    session_id: Uuid,
    target: SessionTarget,
    on_event: Channel<SessionEvent>,
) -> AppResult<()> {
    let settings = state.get_settings().await;
    let store = state.read_store().await?;
    let resolved_target = resolve_target(
        &target,
        &store,
        &settings.ssh,
        default_username().as_deref(),
    )?;

    // A direct connection that asked to be woken first (T29). Behind a bastion this is `None`, and a
    // quick target never is.
    let wake = match &target {
        SessionTarget::Saved { connection_id } => store
            .connections
            .iter()
            .find(|connection| connection.id == *connection_id)
            .and_then(wake_target),
        SessionTarget::Quick { .. } => None,
    };

    // The tab's cancel token, so it can be ended. An SFTP tab receives no keystrokes: one channel whose
    // receiver is never read.
    let (input, _output) = mpsc::unbounded_channel::<crate::sessions::ShellInput>();
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
    let sftp = state.sftp.clone();
    let edits = state.edits.clone();
    let ctx = state.ssh_context();
    let sink: Arc<dyn SessionSink> = Arc::new(EventSink { on_event });

    tauri::async_runtime::spawn(async move {
        // Wake first, and only connect when it finished (a failure or a closed tab stops here). The
        // cleanup below runs in every case.
        let woke = match wake {
            Some(wake) => run_wake_step(&wake, WAKE_POLL_INTERVAL, cancel.clone(), &*sink).await,
            None => true,
        };
        if woke {
            run_sftp_session(
                ctx,
                SftpRun {
                    id: session_id,
                    target: resolved_target,
                    cancel,
                },
                sink,
                sftp.clone(),
            )
            .await;
        }
        sftp.remove(session_id);
        // Cancel the tab's remote-file edits, clear their folders, and emit Closed (T57).
        edits.close_session(session_id);
        sessions.remove(session_id);
        prompts.cancel_session(session_id);
    });

    Ok(())
}

/// The canonical remote path of `path`. An unknown tab is `not_found`.
#[tauri::command]
pub async fn sftp_realpath(
    state: State<'_, AppState>,
    session_id: Uuid,
    path: String,
) -> AppResult<String> {
    ops::realpath(&*state.sftp.get(session_id)?, &path).await
}

/// A remote directory's entries. An unknown tab is `not_found`.
#[tauri::command]
pub async fn sftp_list(
    state: State<'_, AppState>,
    session_id: Uuid,
    path: String,
) -> AppResult<Vec<RemoteEntry>> {
    ops::validate_remote_path("path", &path)?;
    ops::list(&*state.sftp.get(session_id)?, &path).await
}

/// Create a remote directory. An unknown tab is `not_found`.
#[tauri::command]
pub async fn sftp_mkdir(
    state: State<'_, AppState>,
    session_id: Uuid,
    path: String,
) -> AppResult<()> {
    ops::validate_remote_path("path", &path)?;
    ops::mkdir(&*state.sftp.get(session_id)?, &path).await
}

/// Rename a remote path. An unknown tab is `not_found`.
#[tauri::command]
pub async fn sftp_rename(
    state: State<'_, AppState>,
    session_id: Uuid,
    from: String,
    to: String,
) -> AppResult<()> {
    ops::validate_remote_path("from", &from)?;
    ops::validate_remote_path("to", &to)?;
    ops::rename(&*state.sftp.get(session_id)?, &from, &to).await
}

/// How many entries a removal of `path` would clear (S11). An unknown tab is `not_found`.
#[tauri::command]
pub async fn sftp_count(
    state: State<'_, AppState>,
    session_id: Uuid,
    path: String,
) -> AppResult<u64> {
    ops::validate_remote_path("path", &path)?;
    ops::count(&*state.sftp.get(session_id)?, &path).await
}

/// Remove a remote path (a directory, its contents first; S11). An unknown tab is `not_found`.
#[tauri::command]
pub async fn sftp_remove(
    state: State<'_, AppState>,
    session_id: Uuid,
    path: String,
) -> AppResult<()> {
    ops::validate_remote_path("path", &path)?;
    ops::remove(&*state.sftp.get(session_id)?, &path).await
}

/// Change a remote path's permission bits. An unknown tab is `not_found`.
#[tauri::command]
pub async fn sftp_chmod(
    state: State<'_, AppState>,
    session_id: Uuid,
    path: String,
    mode: u32,
) -> AppResult<()> {
    ops::validate_remote_path("path", &path)?;
    ops::chmod(&*state.sftp.get(session_id)?, &path, mode).await
}

/// An SFTP tab's sink on the Tauri side: its events go out through the `Channel` passed at open time,
/// its (unused) output is dropped. A send that fails (the window closed) is logged, never panicked.
pub(crate) struct EventSink {
    pub(crate) on_event: Channel<SessionEvent>,
}

impl SessionSink for EventSink {
    fn event(&self, event: SessionEvent) {
        if self.on_event.send(event).is_err() {
            log::debug!("sftp events channel closed");
        }
    }

    fn output(&self, _bytes: Vec<u8>) {}
}
