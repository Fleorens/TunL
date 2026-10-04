//! The two commands the frontend calls to answer a prompt and to remove a known host (T17).
use tauri::State;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::prompts::PromptAnswer;
use crate::ssh::known_hosts::host_pattern;
use crate::state::AppState;

/// Answer the prompt `id` from the UI. An unknown id is `not_found`.
#[tauri::command]
pub async fn prompt_answer(
    state: State<'_, AppState>,
    id: Uuid,
    answer: PromptAnswer,
) -> AppResult<()> {
    state.prompts.answer(id, answer)
}

/// Remove every known-host line for `(host, port)` from TunL's own file (D10). Returns the count.
#[tauri::command]
pub async fn known_host_remove(
    state: State<'_, AppState>,
    host: String,
    port: u16,
) -> AppResult<u32> {
    if host.is_empty() {
        return Err(AppError::validation("host", "must not be empty"));
    }
    if port == 0 {
        return Err(AppError::validation("port", "must not be 0"));
    }
    let pattern = host_pattern(&host, port);
    let removed = state.known_hosts.remove(&host, port)?;
    if removed > 0 {
        log::info!("removed {removed} known-host line(s) for {pattern}");
    }
    Ok(removed as u32)
}
