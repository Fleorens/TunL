use serde::Serialize;
use tauri::{AppHandle, State};
use ts_rs::TS;

use crate::error::AppResult;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub identifier: String,
    pub tauri_version: String,
    pub config_dir: String,
    pub data_dir: String,
    pub log_dir: String,
    pub started_at_ms: i64,
}

#[tauri::command]
pub async fn app_info(app: AppHandle, state: State<'_, AppState>) -> AppResult<AppInfo> {
    let package = app.package_info();
    Ok(AppInfo {
        name: package.name.clone(),
        version: package.version.to_string(),
        identifier: app.config().identifier.clone(),
        tauri_version: tauri::VERSION.to_string(),
        config_dir: state.paths.config_dir.display().to_string(),
        data_dir: state.paths.data_dir.display().to_string(),
        log_dir: state.paths.log_dir.display().to_string(),
        started_at_ms: state.started_at_ms,
    })
}
