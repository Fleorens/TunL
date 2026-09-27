use serde::{Deserialize, Serialize};
use tauri::State;
use ts_rs::TS;

use crate::error::AppResult;
use crate::model::{Connection, ConnectionInput, Group, Protocol, WolConfig};
use crate::state::AppState;

/// A store read by the frontend: groups, connections, and any file moved aside at startup (T09).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct StoreSnapshot {
    pub groups: Vec<Group>,
    pub connections: Vec<Connection>,
    pub quarantined: Vec<String>,
}

/// The defaults the frontend builds its forms from, without reinventing them (docs/05-modele-donnees.md §2).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ConnectionTemplates {
    pub ssh: ConnectionInput,
    pub rdp: ConnectionInput,
    pub wol: WolConfig,
}

/// The whole store, plus anything quarantined at startup.
#[tauri::command]
pub async fn store_load(state: State<'_, AppState>) -> AppResult<StoreSnapshot> {
    let store = state.read_store().await?;
    Ok(StoreSnapshot {
        groups: store.groups.clone(),
        connections: store.connections.clone(),
        quarantined: state.quarantined.clone(),
    })
}

/// The protocol defaults (SSH and RDP inputs) and the Wake-on-LAN example (docs/05-modele-donnees.md §2).
#[tauri::command]
pub async fn connection_templates() -> AppResult<ConnectionTemplates> {
    Ok(ConnectionTemplates {
        ssh: ConnectionInput::template(Protocol::Ssh),
        rdp: ConnectionInput::template(Protocol::Rdp),
        wol: WolConfig::default(),
    })
}
