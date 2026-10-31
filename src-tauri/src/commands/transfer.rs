//! The three commands that start a file transfer from the UI and answer at once (T26).
//!
//! `sftp_download` and `sftp_upload` validate their arguments, register a cancel token, then spawn the
//! copy in the background and return immediately. The copy reports its steps and its end through one
//! `Channel` (docs/01-architecture.md §6), whose events are pushed by `ChannelSink`.
use std::path::PathBuf;

use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Runtime, State};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::sftp::ops::{is_dir, validate_remote_path};
use crate::sftp::transfer::{TransferEvent, TransferSink, download, upload};
use crate::sftp::tree::download_dir;
use crate::ssh::auth::expand_home;
use crate::state::AppState;

/// Push a transfer's events into the `Channel` the UI opened. A failed send is logged, not raised.
struct ChannelSink(Channel<TransferEvent>);

impl TransferSink for ChannelSink {
    fn event(&self, event: TransferEvent) {
        if let Err(error) = self.0.send(event) {
            log::warn!("transfer event not delivered: {error}");
        }
    }
}

/// Download `remote_path` into the configured download folder, then report through `on_event`. A folder
/// (lstat: a link to a folder is not one) downloads whole, as one transfer (T55).
///
/// The session must be connected (`not_found` otherwise). The folder is `ui.downloadDir` (with `~/`
/// expanded) when set, else the system download folder; it must be a directory. Answers at once.
#[tauri::command]
pub async fn sftp_download<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    session_id: Uuid,
    transfer_id: Uuid,
    remote_path: String,
    on_event: Channel<TransferEvent>,
) -> AppResult<()> {
    let session = state.sftp.get(session_id)?;
    validate_remote_path("remotePath", &remote_path)?;

    let home_dir = std::env::home_dir();
    let home = home_dir.as_deref();
    let settings = state.get_settings().await;
    let dir: PathBuf = match settings.ui.download_dir {
        Some(configured) => expand_home(&configured, home),
        None => app
            .path()
            .download_dir()
            .map_err(|error| AppError::internal(error.to_string()))?,
    };
    if !dir.is_dir() {
        return Err(AppError::validation(
            "ui.downloadDir",
            "must be a directory",
        ));
    }

    let token = CancellationToken::new();
    state.transfers.insert(transfer_id, token.clone())?;
    let transfers = state.transfers.clone();
    tauri::async_runtime::spawn(async move {
        let sink = ChannelSink(on_event);
        // An lstat that fails leaves the file path, whose own `Failed` reports the error as before.
        if matches!(is_dir(&session, &remote_path).await, Ok(true)) {
            download_dir(&session, &remote_path, &dir, token, &sink).await;
        } else {
            download(&session, &remote_path, &dir, token, &sink).await;
        }
        transfers.remove(transfer_id);
    });
    Ok(())
}

/// Upload `local_path` to `remote_dir`, then report through `on_event`.
///
/// The session must be connected (`not_found` otherwise). `local_path` must be absolute. Answers at once.
#[tauri::command]
pub async fn sftp_upload(
    state: State<'_, AppState>,
    session_id: Uuid,
    transfer_id: Uuid,
    local_path: String,
    remote_dir: String,
    on_event: Channel<TransferEvent>,
) -> AppResult<()> {
    let session = state.sftp.get(session_id)?;
    if !PathBuf::from(&local_path).is_absolute() {
        return Err(AppError::validation("localPath", "must be absolute"));
    }
    validate_remote_path("remoteDir", &remote_dir)?;

    let token = CancellationToken::new();
    state.transfers.insert(transfer_id, token.clone())?;
    let transfers = state.transfers.clone();
    tauri::async_runtime::spawn(async move {
        let local = PathBuf::from(local_path);
        upload(&session, &local, &remote_dir, token, &ChannelSink(on_event)).await;
        transfers.remove(transfer_id);
    });
    Ok(())
}

/// Cancel the transfer `transfer_id`. An unknown or finished transfer is not an error.
#[tauri::command]
pub async fn transfer_cancel(state: State<'_, AppState>, transfer_id: Uuid) -> AppResult<()> {
    state.transfers.cancel(transfer_id);
    Ok(())
}
