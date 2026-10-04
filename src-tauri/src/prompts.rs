//! Ask the user something and wait for the answer (docs/01-architecture.md §7).
//!
//! The `PromptBroker` holds one pending answer per prompt id in a `HashMap`, keyed by a `oneshot`
//! channel: `ask` registers the receiver, emits the request, and awaits the sender. `answer`
//! (called from a command) and `cancel_session` (called when a session closes) both take the sender's
//! side away, so the awaiting `ask` resolves. No `std::sync::Mutex` guard is ever held across an
//! `.await`, so `ask` stays `Send` and can be spawned (see `prompts_tests.rs`).
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::sync::oneshot;
use ts_rs::TS;
use uuid::Uuid;

use crate::error::{AppError, AppResult, ErrorKind};
use crate::secrets::SecretValue;

/// Global event the UI listens to in order to show a prompt (docs/01-architecture.md §7).
pub const PROMPT_EVENT: &str = "tunl://prompt";
/// A prompt left unanswered this long is treated as cancelled.
pub const PROMPT_TIMEOUT: Duration = Duration::from_secs(300);

/// What the backend asks the UI to show.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PromptRequest {
    pub id: Uuid,
    pub session_id: Option<Uuid>,
    pub prompt: PromptKind,
}

/// The kind of question, serialized as `"kind"` plus its fields (camelCase).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum PromptKind {
    HostKeyUnknown {
        host: String,
        port: u16,
        key_type: String,
        fingerprint: String,
    },
    Password {
        connection_name: String,
        username: String,
        host: String,
        can_save: bool,
        retry: bool,
    },
    Passphrase {
        connection_name: String,
        key_path: String,
        can_save: bool,
        retry: bool,
    },
    KeyboardInteractive {
        connection_name: String,
        name: String,
        instructions: String,
        prompts: Vec<InteractivePrompt>,
    },
}

/// One line of a keyboard-interactive prompt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct InteractivePrompt {
    pub text: String,
    pub echo: bool,
}

/// The UI's answer. `Debug` is safe: `SecretValue` prints `***` (docs/06-securite.md, S3).
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum PromptAnswer {
    Accept,
    Reject,
    Secret {
        #[ts(type = "string")]
        value: SecretValue,
        save: bool,
    },
    Responses {
        #[ts(type = "Array<string>")]
        values: Vec<SecretValue>,
    },
    Cancel,
}

/// The callback handed to the broker: show a request to the UI.
pub type PromptEmitter = Box<dyn Fn(&PromptRequest) + Send + Sync>;

/// A pending `ask`: its session and the channel that will carry the answer back.
struct Pending {
    session_id: Option<Uuid>,
    sender: oneshot::Sender<PromptAnswer>,
}

/// Removes its prompt id from the table when the `ask` future is dropped (e.g. an aborted tab).
struct PromptGuard<'a> {
    broker: &'a PromptBroker,
    id: Uuid,
}

impl Drop for PromptGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut pending) = self.broker.lock() {
            pending.remove(&self.id);
        }
    }
}

/// Poses questions to the user and collects their answers.
pub struct PromptBroker {
    pending: Mutex<HashMap<Uuid, Pending>>,
    emitter: OnceLock<PromptEmitter>,
    timeout: Duration,
}

impl PromptBroker {
    pub fn new() -> Self {
        Self::with_timeout(PROMPT_TIMEOUT)
    }

    pub fn with_timeout(timeout: Duration) -> Self {
        Self {
            pending: Mutex::new(HashMap::new()),
            emitter: OnceLock::new(),
            timeout,
        }
    }

    /// Register the callback that shows prompts. A second call is ignored (the first wins).
    pub fn set_emitter(&self, emitter: PromptEmitter) {
        if self.emitter.set(emitter).is_err() {
            log::warn!("prompt emitter already set");
        }
    }

    /// Lock the pending table, turning a poisoned mutex into an internal error (no `unwrap`).
    fn lock(&self) -> AppResult<std::sync::MutexGuard<'_, HashMap<Uuid, Pending>>> {
        self.pending
            .lock()
            .map_err(|_| AppError::internal("prompt broker poisoned"))
    }

    /// Pose a prompt and wait for the answer.
    pub async fn ask(
        &self,
        session_id: Option<Uuid>,
        prompt: PromptKind,
    ) -> AppResult<PromptAnswer> {
        let emitter = self
            .emitter
            .get()
            .ok_or_else(|| AppError::internal("no prompt emitter"))?;

        let id = Uuid::new_v4();
        let (sender, receiver) = oneshot::channel();
        {
            let mut pending = self.lock()?;
            pending.insert(id, Pending { session_id, sender });
        }

        // The guard removes `id` no matter how `ask` returns, even if the future is dropped.
        let _guard = PromptGuard { broker: self, id };

        // Release the lock before emitting: an emitter may answer from inside `ask`.
        emitter(&PromptRequest {
            id,
            session_id,
            prompt,
        });

        match tokio::time::timeout(self.timeout, receiver).await {
            Ok(Ok(answer)) => Ok(answer),
            // The sender was dropped (cancel_session) before the answer arrived.
            Ok(Err(_)) => Err(AppError::new(ErrorKind::Cancelled, "prompt cancelled")),
            // The timeout fired before any answer.
            Err(_elapsed) => Err(AppError::new(ErrorKind::Cancelled, "prompt timed out")),
        }
    }

    /// Deliver an answer to the prompt `id`. An unknown id is `not_found`.
    pub fn answer(&self, id: Uuid, answer: PromptAnswer) -> AppResult<()> {
        let mut pending = self.lock()?;
        let entry = pending
            .remove(&id)
            .ok_or_else(|| AppError::not_found(format!("prompt {id}")))?;
        entry
            .sender
            .send(answer)
            .map_err(|_| AppError::internal(format!("prompt {id} receiver was dropped")))
    }

    /// Cancel every prompt of `session_id` (and drop them). Other sessions are untouched.
    pub fn cancel_session(&self, session_id: Uuid) {
        let mut pending = match self.lock() {
            Ok(pending) => pending,
            Err(_) => return,
        };
        let ids: Vec<Uuid> = pending
            .keys()
            .filter(|id| pending[*id].session_id == Some(session_id))
            .copied()
            .collect();
        for id in ids {
            if let Some(entry) = pending.remove(&id) {
                // Dropping the sender makes the awaiting `ask` resolve as cancelled.
                drop(entry.sender);
            }
        }
    }

    /// How many prompts are currently waiting for an answer.
    pub fn pending_count(&self) -> usize {
        match self.lock() {
            Ok(pending) => pending.len(),
            Err(_) => 0,
        }
    }
}

impl Default for PromptBroker {
    fn default() -> Self {
        Self::new()
    }
}
