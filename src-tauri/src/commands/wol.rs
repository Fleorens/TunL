//! The `wol_wake` command: send a connection's magic packet on demand (T29).
use uuid::Uuid;

use tauri::State;

use crate::error::AppResult;
use crate::state::AppState;
use crate::wol::send_magic_packet;

/// Send the magic packet of the connection named by `id` (as `src/lib/ipc.ts` sends it). No wait: the
/// user sees the status dot go green on its own.
#[tauri::command]
pub async fn wol_wake(state: State<'_, AppState>, id: Uuid) -> AppResult<()> {
    let store = state.get_store().await;
    let connection = store
        .connections
        .iter()
        .find(|connection| connection.id == id)
        .ok_or_else(|| crate::error::AppError::not_found(format!("connection {id}")))?;

    let config = connection
        .wol
        .as_ref()
        .ok_or_else(|| crate::error::AppError::validation("wol", "is not configured"))?;

    send_magic_packet(config).await
}
