//! The `rdp_detect` command: report the FreeRDP 3 client TunL would launch with.

use tauri::State;

use crate::error::AppResult;
use crate::rdp::detect::{RdpClient, VERSION_TIMEOUT, detect};
use crate::state::AppState;

/// Find the FreeRDP 3 client, from the forced path in the settings or the `PATH`.
#[tauri::command]
pub async fn rdp_detect(state: State<'_, AppState>) -> AppResult<RdpClient> {
    let settings = state.get_settings().await;
    // The `PATH` of the process; empty when it is not set.
    let path_var = std::env::var_os("PATH").unwrap_or_default();
    detect(
        settings.rdp.client_path.as_deref(),
        &path_var,
        VERSION_TIMEOUT,
    )
    .await
}
