use tauri::State;

use crate::error::AppResult;
use crate::state::AppState;
use crate::store::tabs::{SavedTab, load_tabs, save_tabs};

/// The tabs saved last time, in order, to reopen at startup (T60).
#[tauri::command]
pub async fn tabs_load(state: State<'_, AppState>) -> AppResult<Vec<SavedTab>> {
    Ok(load_tabs(&state.paths.config_dir))
}

/// Replace the tabs saved last time (T60): the commands write `tabs.json`, not `settings.json`.
#[tauri::command]
pub async fn tabs_save(state: State<'_, AppState>, tabs: Vec<SavedTab>) -> AppResult<()> {
    save_tabs(&state.paths.config_dir, &tabs)
}
