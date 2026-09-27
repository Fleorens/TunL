use serde::Deserialize;
use tauri::State;
use uuid::Uuid;

use crate::clock::now_ms;
use crate::error::AppResult;
use crate::model::{Connection, ConnectionInput};
use crate::state::AppState;

#[derive(Deserialize)]
pub struct CreateRequest {
    input: ConnectionInput,
}

#[derive(Deserialize)]
pub struct UpdateRequest {
    id: Uuid,
    input: ConnectionInput,
}

#[derive(Deserialize)]
pub struct DuplicateRequest {
    id: Uuid,
}

#[derive(Deserialize)]
pub struct DeleteRequest {
    id: Uuid,
}

#[derive(Deserialize)]
pub struct SetFavoriteRequest {
    id: Uuid,
    favorite: bool,
}

#[derive(Deserialize)]
pub struct TouchRequest {
    id: Uuid,
}

/// Validate and append a fresh connection. The store is never mutated in place (T08).
#[tauri::command]
pub async fn connection_create(
    state: State<'_, AppState>,
    req: CreateRequest,
) -> AppResult<Connection> {
    let now = now_ms();
    let id = Uuid::new_v4();
    let created = state
        .mutate(|store| store.create_connection(&req.input, id, now))
        .await?;
    log::info!("connection created: {}", created.name);
    Ok(created)
}

/// Apply validated `input` to an existing connection, keeping its id and creation date.
#[tauri::command]
pub async fn connection_update(
    state: State<'_, AppState>,
    req: UpdateRequest,
) -> AppResult<Connection> {
    let now = now_ms();
    let updated = state
        .mutate(|store| store.update_connection(req.id, &req.input, now))
        .await?;
    log::info!("connection updated: {}", updated.name);
    Ok(updated)
}

/// Copy a connection under a fresh id, with a free `(n)` suffix and no history.
#[tauri::command]
pub async fn connection_duplicate(
    state: State<'_, AppState>,
    req: DuplicateRequest,
) -> AppResult<Connection> {
    let now = now_ms();
    let new_id = Uuid::new_v4();
    let duplicated = state
        .mutate(|store| store.duplicate_connection(req.id, new_id, now))
        .await?;
    log::info!("connection duplicated: {}", duplicated.name);
    Ok(duplicated)
}

/// Remove a connection, refusing a bastion still used as a jump host.
#[tauri::command]
pub async fn connection_delete(state: State<'_, AppState>, req: DeleteRequest) -> AppResult<()> {
    state
        .mutate(|store| {
            let next = store.delete_connection(req.id)?;
            Ok((next, ()))
        })
        .await?;
    log::info!("connection deleted: {}", req.id);
    Ok(())
}

/// Toggle the favorite flag, bumping `updated_at`.
#[tauri::command]
pub async fn connection_set_favorite(
    state: State<'_, AppState>,
    req: SetFavoriteRequest,
) -> AppResult<Connection> {
    let now = now_ms();
    let updated = state
        .mutate(|store| store.set_favorite(req.id, req.favorite, now))
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
pub async fn connection_touch(
    state: State<'_, AppState>,
    req: TouchRequest,
) -> AppResult<Connection> {
    let now = now_ms();
    let updated = state
        .mutate(|store| store.touch_connection(req.id, now))
        .await?;
    log::info!("connection {} touched", updated.name);
    Ok(updated)
}
