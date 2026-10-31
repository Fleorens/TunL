//! The SFTP backend: the connected tabs registry, the remote-entry types, and the operations on a
//! session (T24). A tab is a session like a shell: its `SftpSession` lives in `SftpRegistry` while it
//! is connected, and every `sftp_*` command finds it there (docs/01 §6).
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::Mutex;

use russh_sftp::client::SftpSession;
use serde::Serialize;
use tokio_util::sync::CancellationToken;
use ts_rs::TS;
use uuid::Uuid;

use crate::error::{AppError, AppResult};

pub mod ops;
pub mod session;
pub mod transfer;
pub mod tree;

#[cfg(test)]
mod ops_tests;
#[cfg(test)]
mod transfer_reserve_tests;
#[cfg(test)]
mod transfer_tests;

/// The kind of a remote entry, from the mode bits of its attributes (docs/05 §8).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum EntryKind {
    File,
    Dir,
    Symlink,
    Other,
}

/// One entry of a remote directory (docs/05 §8).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RemoteEntry {
    /// The entry's own name, never a path.
    pub name: String,
    /// `dir` + "/" + `name`, the path the entry lives at.
    pub path: String,
    pub kind: EntryKind,
    pub size: u64,
    /// The modification time in Unix milliseconds, when the server sent one.
    pub modified_at: Option<i64>,
    /// The permission bits only (`mode & 0o7777`), the file type dropped.
    pub permissions: Option<u32>,
    /// True when the name starts with ".", as the shell's `ls` hides them.
    pub hidden: bool,
    /// For a symlink, the kind of what it points to; `None` for any other entry, and for a link the
    /// server will not answer (T48).
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub target_kind: Option<EntryKind>,
}

/// The connected SFTP tabs, by tab id (docs/01 §6).
///
/// `SftpSession` does not implement `Debug`, so neither does this registry (T24's test would not
/// compile against a derived one).
#[derive(Default)]
pub struct SftpRegistry {
    sessions: Mutex<HashMap<Uuid, Arc<SftpSession>>>,
}

impl SftpRegistry {
    /// Register `session` under `id`, replacing any that was there.
    pub fn insert(&self, id: Uuid, session: Arc<SftpSession>) {
        if let Ok(mut map) = self.sessions.lock() {
            map.insert(id, session);
        }
    }

    /// The session registered under `id`, or `not_found("sftp session <id>")` when the tab is not
    /// (or no longer) connected.
    pub fn get(&self, id: Uuid) -> AppResult<Arc<SftpSession>> {
        let map = self
            .sessions
            .lock()
            .map_err(|e| AppError::internal(format!("sftp registry poisoned: {e}")))?;
        map.get(&id)
            .cloned()
            .ok_or_else(|| AppError::not_found(format!("sftp session {id}")))
    }

    /// Forget the session `id` without cancelling it. Idempotent.
    pub fn remove(&self, id: Uuid) {
        if let Ok(mut map) = self.sessions.lock() {
            map.remove(&id);
        }
    }
}

/// The transfers in progress, by id: the token that cancels each one (T26).
#[derive(Default)]
pub struct TransferRegistry {
    running: Mutex<HashMap<Uuid, CancellationToken>>,
}

impl TransferRegistry {
    /// Register `cancel` under `id`; an id already in use is a validation error.
    pub fn insert(&self, id: Uuid, cancel: CancellationToken) -> AppResult<()> {
        let mut map = self
            .running
            .lock()
            .map_err(|e| AppError::internal(format!("transfer registry poisoned: {e}")))?;
        if map.contains_key(&id) {
            return Err(AppError::validation("transferId", "already in use"));
        }
        map.insert(id, cancel);
        Ok(())
    }

    /// Cancel the transfer `id`; unknown or finished: nothing.
    pub fn cancel(&self, id: Uuid) {
        if let Ok(map) = self.running.lock()
            && let Some(token) = map.get(&id)
        {
            token.cancel();
        }
    }

    /// Cancel every running transfer. Each one forgets itself as it ends.
    pub fn cancel_all(&self) {
        let tokens: Vec<CancellationToken> = match self.running.lock() {
            Ok(map) => map.values().cloned().collect(),
            Err(_) => return,
        };
        for token in tokens {
            token.cancel();
        }
    }

    /// Forget the transfer `id`. Idempotent.
    pub fn remove(&self, id: Uuid) {
        if let Ok(mut map) = self.running.lock() {
            map.remove(&id);
        }
    }
}
