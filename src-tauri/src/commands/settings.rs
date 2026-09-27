use serde::Deserialize;
use tauri::State;

use crate::error::AppResult;
use crate::model::{Settings, normalize_settings};
use crate::state::AppState;

#[derive(Deserialize)]
pub struct UpdateRequest {
    settings: Settings,
}

/// The current settings.
#[tauri::command]
pub async fn settings_get(state: State<'_, AppState>) -> AppResult<Settings> {
    Ok(state.get_settings().await)
}

/// Replace the settings with a normalized copy of what the frontend sent.
#[tauri::command]
pub async fn settings_update(
    state: State<'_, AppState>,
    req: UpdateRequest,
) -> AppResult<Settings> {
    let updated = state
        .mutate_settings(move |_current| normalize_settings(&req.settings))
        .await?;
    log::info!("settings updated");
    Ok(updated)
}
