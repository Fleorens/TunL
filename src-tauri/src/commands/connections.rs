use tauri::State;
use uuid::Uuid;

use crate::clock::now_ms;
use crate::error::AppResult;
use crate::model::{Connection, ConnectionInput};
use crate::state::AppState;

/// Validate and append a fresh connection. The store is never mutated in place (T08).
#[tauri::command]
pub async fn connection_create(
    state: State<'_, AppState>,
    input: ConnectionInput,
) -> AppResult<Connection> {
    let now = now_ms();
    let id = Uuid::new_v4();
    let created = state
        .mutate(|store| store.create_connection(&input, id, now))
        .await?;
    log::info!("connection created: {}", created.name);
    Ok(created)
}

/// Apply validated `input` to an existing connection, keeping its id and creation date.
#[tauri::command]
pub async fn connection_update(
    state: State<'_, AppState>,
    id: Uuid,
    input: ConnectionInput,
) -> AppResult<Connection> {
    let now = now_ms();
    let updated = state
        .mutate(|store| store.update_connection(id, &input, now))
        .await?;
    log::info!("connection updated: {}", updated.name);
    Ok(updated)
}

/// Copy a connection under a fresh id, with a free `(n)` suffix and no history.
#[tauri::command]
pub async fn connection_duplicate(state: State<'_, AppState>, id: Uuid) -> AppResult<Connection> {
    let now = now_ms();
    let new_id = Uuid::new_v4();
    let duplicated = state
        .mutate(|store| store.duplicate_connection(id, new_id, now))
        .await?;
    log::info!("connection duplicated: {}", duplicated.name);
    Ok(duplicated)
}

/// Remove a connection, refusing a bastion still used as a jump host.
#[tauri::command]
pub async fn connection_delete(state: State<'_, AppState>, id: Uuid) -> AppResult<()> {
    state
        .mutate(|store| {
            let next = store.delete_connection(id)?;
            Ok((next, ()))
        })
        .await?;
    log::info!("connection deleted: {}", id);
    Ok(())
}

/// Toggle the favorite flag, bumping `updated_at`.
#[tauri::command]
pub async fn connection_set_favorite(
    state: State<'_, AppState>,
    id: Uuid,
    favorite: bool,
) -> AppResult<Connection> {
    let now = now_ms();
    let updated = state
        .mutate(|store| store.set_favorite(id, favorite, now))
        .await?;
    log::info!(
        "connection {} favorite set to {}",
        updated.name,
        updated.favorite
    );
    Ok(updated)
}

/// Record that a connection was just used, without treating it as an edit.
#[tauri::command]
pub async fn connection_touch(state: State<'_, AppState>, id: Uuid) -> AppResult<Connection> {
    let now = now_ms();
    let updated = state
        .mutate(|store| store.touch_connection(id, now))
        .await?;
    log::info!("connection {} touched", updated.name);
    Ok(updated)
}
