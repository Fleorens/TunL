//! The three commands the frontend calls: write, test presence, delete (S2: never read).
use tauri::State;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::secrets::{SecretKind, SecretValue, validate_secret};
use crate::state::AppState;

/// Write a secret for a connection (replacing any previous one of the same kind).
#[tauri::command]
pub async fn secret_set(
    state: State<'_, AppState>,
    connection_id: Uuid,
    kind: SecretKind,
    value: SecretValue,
) -> AppResult<()> {
    validate_secret(&value)?;
    let connection_name = state
        .read_store()
        .await?
        .connections
        .iter()
        .find(|connection| connection.id == connection_id)
        .map(|connection| connection.name.clone())
        .ok_or_else(|| AppError::not_found(format!("connection {connection_id}")))?;
    state
        .secrets
        .set(connection_id, &connection_name, kind, &value)
        .await?;
    Ok(())
}

/// Whether a secret of `kind` is stored for `connection_id`.
#[tauri::command]
pub async fn secret_has(
    state: State<'_, AppState>,
    connection_id: Uuid,
    kind: SecretKind,
) -> AppResult<bool> {
    state.secrets.has(connection_id, kind).await
}

/// Forget a secret. An absent secret is not an error.
#[tauri::command]
pub async fn secret_delete(
    state: State<'_, AppState>,
    connection_id: Uuid,
    kind: SecretKind,
) -> AppResult<()> {
    state.secrets.delete(connection_id, kind).await
}
