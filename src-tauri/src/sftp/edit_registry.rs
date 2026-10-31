//! The edits in progress, by id: the tab, the cancel token, the local copy, the events sink, and the
//! way `sftp_edit_resolve` answers a conflict (T57).
//!
//! Closing a tab cancels its edits, clears their folders, and emits `Closed` (docs/01 §6).
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

use russh_sftp::client::SftpSession;
use tauri::ipc::Channel;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::sftp::edit::clear_edits;
use crate::sftp::edit::{EditEvent, PushError, RemoteStamp, push};

/// Something that receives an edit's events (the UI, through a `Channel`).
pub trait EditSink: Send + Sync {
    fn event(&self, event: EditEvent);
}

/// A `Channel` of `EditEvent`s (commands/edit.rs). A failed send, the window closed, is logged.
pub(crate) struct EditChannelSink(pub(crate) Channel<EditEvent>);

impl EditSink for EditChannelSink {
    fn event(&self, event: EditEvent) {
        if self.0.send(event).is_err() {
            log::debug!("edit events channel closed");
        }
    }
}

/// One edit, registered while its watch task runs.
struct EditEntry {
    session_id: Uuid,
    cancel: CancellationToken,
    local: PathBuf,
    sink: Arc<dyn EditSink>,
    resolve: mpsc::UnboundedSender<bool>,
}

/// The edits in progress, by id (T57).
#[derive(Default)]
pub struct EditRegistry {
    edits: Mutex<HashMap<Uuid, EditEntry>>,
}

impl EditRegistry {
    /// Register `edit_id` for a tab. An id already in use is a validation error.
    pub fn insert(
        &self,
        edit_id: Uuid,
        session_id: Uuid,
        local: PathBuf,
        sink: Arc<dyn EditSink>,
        resolve: mpsc::UnboundedSender<bool>,
        cancel: CancellationToken,
    ) -> AppResult<()> {
        let mut map = self
            .edits
            .lock()
            .map_err(|e| AppError::internal(format!("edit registry poisoned: {e}")))?;
        if map.contains_key(&edit_id) {
            return Err(AppError::validation("editId", "already in use"));
        }
        map.insert(
            edit_id,
            EditEntry {
                session_id,
                cancel,
                local,
                sink,
                resolve,
            },
        );
        Ok(())
    }

    /// Answer a conflict for `edit_id`: push again with `overwrite`, or keep the last stamp. Calling it
    /// on an unknown edit, or one not waiting, is not an error (the message is just dropped).
    pub fn answer(&self, edit_id: Uuid, overwrite: bool) {
        if let Ok(map) = self.edits.lock()
            && let Some(entry) = map.get(&edit_id)
        {
            let _ = entry.resolve.send(overwrite);
        }
    }

    /// Forget the edit `edit_id`. Idempotent (the watch task calls it when it ends; `close_session`
    /// removes the entries of a closed tab).
    pub fn remove(&self, edit_id: Uuid) {
        if let Ok(mut map) = self.edits.lock() {
            map.remove(&edit_id);
        }
    }

    /// Close every edit of `session_id`: cancel the watch tasks, forget them, clear their folders, and
    /// emit `Closed` (docs/01 §6). A poisoned lock closes nothing.
    pub fn close_session(&self, session_id: Uuid) {
        struct Pending {
            local: PathBuf,
            cancel: CancellationToken,
            sink: Arc<dyn EditSink>,
        }
        let pending: Vec<Pending> = {
            let mut map = match self.edits.lock() {
                Ok(map) => map,
                Err(_) => return,
            };
            let mut pending = Vec::new();
            map.retain(|_, entry| {
                if entry.session_id == session_id {
                    pending.push(Pending {
                        local: entry.local.clone(),
                        cancel: entry.cancel.clone(),
                        sink: entry.sink.clone(),
                    });
                    false
                } else {
                    true
                }
            });
            pending
        };
        for entry in pending {
            entry.cancel.cancel();
            // The edit's own folder (`<edit_dir>/<edit_id>`), not the whole edit dir (other tabs keep theirs).
            if let Some(parent) = entry.local.parent() {
                let _ = clear_edits(parent);
            }
            entry.sink.event(EditEvent::Closed);
        }
    }
}

/// What a watch task polls: the local file's size and modification time (seconds, like the remote stamp).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LocalStamp {
    pub size: u64,
    pub mtime: u32,
}

/// The local file's stamp, or `None` when it cannot be read (deleted, or never written).
pub fn local_stamp(local: &Path) -> Option<LocalStamp> {
    let metadata = std::fs::metadata(local).ok()?;
    let mtime = metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_secs() as u32;
    Some(LocalStamp {
        size: metadata.len(),
        mtime,
    })
}

/// How often the watch task polls the local file (T57).
pub const EDIT_POLL: std::time::Duration = std::time::Duration::from_secs(1);

/// Watch one edit for local saves, and push them to the remote file (T57).
///
/// The local file is polled every `EDIT_POLL`; a change is pushed when it is stable over two polls and
/// differs from the last one sent (an editor that writes in several places pushes once). A remote
/// conflict stops the task on `resolve_rx` until `sftp_edit_resolve` answers.
pub async fn run_edit_watch(
    sftp: Arc<SftpSession>,
    remote: &str,
    local: &Path,
    expected: RemoteStamp,
    cancel: CancellationToken,
    mut resolve_rx: mpsc::UnboundedReceiver<bool>,
    sink: &dyn EditSink,
) {
    let mut poll = tokio::time::interval(EDIT_POLL);
    let mut last: Option<LocalStamp> = None;
    // `expected` is the remote stamp checked for a conflict before each push; `last_sent` is the local
    // stamp of the last push, so an unchanged local file is not pushed again.
    let mut expected = expected;
    let mut last_sent: Option<LocalStamp> = None;
    loop {
        poll.tick().await;
        if cancel.is_cancelled() {
            break;
        }
        let Some(current) = local_stamp(local) else {
            last = None;
            continue;
        };
        // Push only when the value is stable over two polls and differs from the last one sent.
        let stable_change = match last {
            Some(prev) => current == prev && Some(current) != last_sent,
            None => false,
        };
        last = Some(current);
        if !stable_change {
            continue;
        }

        match push(&sftp, local, remote, Some(expected)).await {
            Ok(new) => {
                sink.event(EditEvent::Saved);
                expected = new;
                last_sent = Some(current);
            }
            Err(PushError::Failed(error)) => sink.event(EditEvent::Failed { error }),
            Err(PushError::Conflict) => {
                sink.event(EditEvent::Conflict);
                // Wait for `sftp_edit_resolve`: overwrite writes anyway, otherwise the last stamp is kept.
                let overwrite = tokio::select! {
                    _ = cancel.cancelled() => false,
                    answer = resolve_rx.recv() => answer.unwrap_or(false),
                };
                if overwrite {
                    match push(&sftp, local, remote, None).await {
                        Ok(new) => {
                            sink.event(EditEvent::Saved);
                            expected = new;
                            last_sent = Some(current);
                        }
                        Err(PushError::Failed(error)) => sink.event(EditEvent::Failed { error }),
                        Err(PushError::Conflict) => sink.event(EditEvent::Conflict),
                    }
                }
            }
        }
    }
}
