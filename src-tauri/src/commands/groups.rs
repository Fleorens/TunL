use tauri::State;
use uuid::Uuid;

use crate::commands::store::StoreSnapshot;
use crate::error::AppResult;
use crate::model::{Group, GroupInput};
use crate::state::AppState;

/// Validate and append a fresh group.
#[tauri::command]
pub async fn group_create(state: State<'_, AppState>, input: GroupInput) -> AppResult<Group> {
    let id = Uuid::new_v4();
    let created = state.mutate(|store| store.create_group(&input, id)).await?;
    log::info!("group created: {}", created.name);
    Ok(created)
}

/// Apply validated `input` to an existing group.
#[tauri::command]
pub async fn group_update(
    state: State<'_, AppState>,
    id: Uuid,
    input: GroupInput,
) -> AppResult<Group> {
    let updated = state.mutate(|store| store.update_group(id, &input)).await?;
    log::info!("group updated: {}", updated.name);
    Ok(updated)
}

/// Remove a group; its connections lose their group without being edited. Returns the whole store.
#[tauri::command]
pub async fn group_delete(state: State<'_, AppState>, id: Uuid) -> AppResult<StoreSnapshot> {
    let quarantined = state.quarantined.clone();
    let snapshot = state
        .mutate(move |store| {
            let next = store.delete_group(id)?;
            let snapshot = StoreSnapshot {
                groups: next.groups.clone(),
                connections: next.connections.clone(),
                quarantined,
            };
            Ok((next, snapshot))
        })
        .await?;
    log::info!("group deleted: {}", id);
    Ok(snapshot)
}

/// Rewrite the group order, accepting only a full permutation of the current groups.
#[tauri::command]
pub async fn group_reorder(state: State<'_, AppState>, ids: Vec<Uuid>) -> AppResult<Vec<Group>> {
    let groups = state
        .mutate(|store| {
            let next = store.reorder_groups(&ids)?;
            let groups = next.groups.clone();
            Ok((next, groups))
        })
        .await?;
    log::info!("groups reordered: {}", ids.len());
    Ok(groups)
}
