//! The two commands that start editing a remote file from the UI and answer at once (T57).
//!
//! `sftp_edit` downloads the file into a private folder, opens it with the default application, then
//! spawns a task that watches the local copy for saves and pushes them back in place. `sftp_edit_resolve`
//! answers the conflict a push may report. The steps go out through one `Channel` (docs/01 §6).
use std::sync::Arc;

use tauri::ipc::Channel;
use tauri::{AppHandle, Runtime, State};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::error::{AppError, AppResult, ErrorKind};
use crate::sftp::edit::{self, EditEvent};
use crate::sftp::edit_registry::{EditChannelSink, EditSink, run_edit_watch};
use crate::sftp::ops;
use crate::state::AppState;

/// Edit `remote_path` on a connected tab: download it into a private folder, open it with the default
/// application, then push every local save back in place. Answers at once (T57).
///
/// The session must be connected (`not_found` otherwise), the path valid, and a private edit folder
/// configured (`no private runtime directory` otherwise). The download happens before anything is
/// reported: a download error comes back to the call.
#[tauri::command]
pub async fn sftp_edit<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    session_id: Uuid,
    edit_id: Uuid,
    remote_path: String,
    on_event: Channel<EditEvent>,
) -> AppResult<()> {
    let session = state.sftp.get(session_id)?;
    ops::validate_remote_path("remotePath", &remote_path)?;
    let edit_dir = state
        .paths
        .edit_dir
        .as_deref()
        .ok_or_else(|| AppError::new(ErrorKind::Io, "no private runtime directory"))?;

    // Download into the private folder before reporting anything (a download error comes back to the call).
    let (local, expected) = edit::fetch(&session, &remote_path, edit_dir, edit_id).await?;

    // Register the edit so close_session can cancel it, clear its folder, and answer its conflicts.
    let (resolve_tx, resolve_rx) = mpsc::unbounded_channel::<bool>();
    let cancel = CancellationToken::new();
    let sink: Arc<dyn EditSink> = Arc::new(EditChannelSink(on_event));
    state.edits.insert(
        edit_id,
        session_id,
        local.clone(),
        sink.clone(),
        resolve_tx,
        cancel.clone(),
    )?;

    // Hand the local copy to the default application. A failure is reported, but the watch keeps running.
    match app
        .opener()
        .open_path(local.display().to_string(), None::<&str>)
    {
        Ok(()) => sink.event(EditEvent::Opened {
            local_path: local.to_string_lossy().into_owned(),
        }),
        Err(error) => {
            log::warn!("cannot open the local file: {error}");
            sink.event(EditEvent::Failed {
                error: AppError::new(ErrorKind::Io, error.to_string()),
            });
        }
    }

    // Watch the local file for saves and push them back. It removes itself from the registry when it ends.
    let edits = state.edits.clone();
    let local_for_watch = local.clone();
    tauri::async_runtime::spawn(async move {
        run_edit_watch(
            session,
            &remote_path,
            &local_for_watch,
            expected,
            cancel,
            resolve_rx,
            &*sink,
        )
        .await;
        edits.remove(edit_id);
    });

    Ok(())
}

/// Answer a conflict for `edit_id`: push again with `overwrite`, or keep the last stamp. An unknown edit,
/// or one not waiting, is not an error (the message is just dropped).
#[tauri::command]
pub async fn sftp_edit_resolve(
    state: State<'_, AppState>,
    edit_id: Uuid,
    overwrite: bool,
) -> AppResult<()> {
    state.edits.answer(edit_id, overwrite);
    Ok(())
}
