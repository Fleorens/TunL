//! Where a running session reports, and the registry that maps a tab id to its session (docs/01 §6).
//!
//! Each tab is one session: `SessionRegistry` holds the cancel token and the channel the UI writes
//! keystrokes and resize events to. Closing a tab cancels and forgets; a session task forgets itself
//! when it ends; sending to a finished task fails like an unknown one.
use std::collections::HashMap;
use std::sync::Mutex;

use serde::Serialize;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use ts_rs::TS;
use uuid::Uuid;

use crate::error::{AppError, AppResult};

/// The kind of a session step, mirrored to the frontend as `"wake"`, `"hop"` … (docs/01 §6).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum StepKind {
    Wake,
    Hop,
    Target,
    HostKey,
    Auth,
    Open,
    Launch,
}

/// Where a step is in its work: starting, done, or failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum StepState {
    Started,
    Done,
    Failed,
}

/// Why a session ended, reported as `SessionEvent::Closed` (docs/01 §6).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum CloseReason {
    UserClosed,
    RemoteClosed,
    ProcessExited,
    Error,
}

/// Everything a session sends back to the UI: its steps, a connected banner, the end, or an error.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum SessionEvent {
    Step {
        step: StepKind,
        label: String,
        state: StepState,
    },
    Connected,
    Log {
        line: String,
    },
    Closed {
        reason: CloseReason,
        exit_status: Option<i32>,
    },
    Error {
        error: AppError,
    },
}

/// A keystroke or a resize, sent from the UI to the task running one session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShellInput {
    Data(Vec<u8>),
    Resize { cols: u32, rows: u32 },
}

/// Where a running session reports. Tauri: two `Channel`s (commands/ssh.rs). Tests: a recorder.
pub trait SessionSink: Send + Sync + 'static {
    fn event(&self, event: SessionEvent);
    fn output(&self, bytes: Vec<u8>);
}

/// The handle a tab keeps: the token that ends the task, and the way to write to it.
#[derive(Clone)]
pub struct SessionHandle {
    pub cancel: CancellationToken,
    pub input: mpsc::UnboundedSender<ShellInput>,
}

/// One live session per id, so a tab id is used once and the UI can write to it (docs/01 §6).
#[derive(Default)]
pub struct SessionRegistry {
    sessions: Mutex<HashMap<Uuid, SessionHandle>>,
}

impl SessionRegistry {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    /// Register `id` for a session. A second session on the same id is refused (a tab is one thing).
    pub fn insert(&self, id: Uuid, handle: SessionHandle) -> AppResult<()> {
        let mut map = self
            .sessions
            .lock()
            .map_err(|e| AppError::internal(format!("session registry poisoned: {e}")))?;
        if map.contains_key(&id) {
            return Err(AppError::validation("sessionId", "is already open"));
        }
        map.insert(id, handle);
        Ok(())
    }

    /// Write `input` to the session `id`. An unknown id, or a task that ended and dropped its
    /// receiver, fails the same way: the session is gone.
    pub fn send(&self, id: Uuid, input: ShellInput) -> AppResult<()> {
        let handle = {
            let map = self
                .sessions
                .lock()
                .map_err(|e| AppError::internal(format!("session registry poisoned: {e}")))?;
            map.get(&id)
                .cloned()
                .ok_or_else(|| AppError::not_found(format!("session {id}")))?
        };
        handle
            .input
            .send(input)
            .map_err(|_| AppError::not_found(format!("session {id}")))
    }

    /// Cancel the session `id` and forget it. Closing twice is harmless.
    pub fn close(&self, id: Uuid) -> bool {
        if let Some(handle) = self
            .sessions
            .lock()
            .ok()
            .and_then(|mut map| map.remove(&id))
        {
            handle.cancel.cancel();
            true
        } else {
            false
        }
    }

    /// Forget the session `id` without cancelling it: the task calls this when it ends.
    pub fn remove(&self, id: Uuid) {
        if let Ok(mut map) = self.sessions.lock() {
            map.remove(&id);
        }
    }

    pub fn len(&self) -> usize {
        self.sessions.lock().map(|map| map.len()).unwrap_or(0)
    }

    pub fn is_empty(&self) -> bool {
        self.sessions
            .lock()
            .map(|map| map.is_empty())
            .unwrap_or(true)
    }
}
