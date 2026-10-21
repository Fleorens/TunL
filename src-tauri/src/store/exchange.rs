//! Export and import of the whole store as one JSON file, without any credential (docs/06-securite.md S1).
//!
//! The export is a snapshot of the store; the import fuses it: nothing is overwritten or removed,
//! every connection gets a fresh id, and a connection already here (same protocol, host, port and
//! user) is left aside. `plan_import` never mutates the store it is given.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::model::{Connection, ConnectionInput, Group, GroupInput};

use super::Store;

/// The format tag every export carries, so an import can tell it apart from any other JSON file.
pub const EXPORT_FORMAT: &str = "tunl-connections";
/// The export format version. A file from a newer TunL is refused (docs/05-modele-donnees.md §4).
pub const EXPORT_VERSION: u32 = 1;

/// The whole store as one document: its groups and connections, without any history.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportFile {
    pub format: String,
    pub version: u32,
    pub exported_at: i64,
    pub groups: Vec<Group>,
    pub connections: Vec<Connection>,
}

/// What `plan_import` did: how many connections it added, left aside, or refused, and how many
/// groups it had to create.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ImportReport {
    pub added: u32,
    pub skipped: u32,
    pub invalid: u32,
    pub groups_created: u32,
}

/// Same connection, compared without its identity or history: protocol, host (case-insensitive),
/// port and user. Two connections with the same key are the same server.
fn same_connection(a: &Connection, b: &Connection) -> bool {
    (
        a.settings.protocol(),
        a.host.to_lowercase(),
        a.port,
        a.username.clone(),
    ) == (
        b.settings.protocol(),
        b.host.to_lowercase(),
        b.port,
        b.username.clone(),
    )
}

/// The whole store, `last_connected_at` cleared (it is history, not configuration).
pub fn export_file(store: &Store, now_ms: i64) -> ExportFile {
    let connections = store
        .connections
        .iter()
        .map(|connection| {
            let mut connection = connection.clone();
            connection.last_connected_at = None;
            connection
        })
        .collect();
    ExportFile {
        format: EXPORT_FORMAT.into(),
        version: EXPORT_VERSION,
        exported_at: now_ms,
        groups: store.groups.clone(),
        connections,
    }
}

/// Fuses `file` into `store`: a new store and the account of what it did. `store` is never mutated.
pub fn plan_import(
    store: &Store,
    file: &ExportFile,
    now_ms: i64,
    mut new_id: impl FnMut() -> Uuid,
) -> AppResult<(Store, ImportReport)> {
    // 1. Header: refuse any other document than a TunL export.
    if file.format != EXPORT_FORMAT {
        return Err(AppError::validation("format", "is not a TunL export"));
    }
    if file.version > EXPORT_VERSION {
        return Err(AppError::validation("version", "comes from a newer TunL"));
    }

    let mut next = store.clone();
    let mut report = ImportReport::default();

    // 2. Groups, matched by name (case-insensitive, trimmed) or created.
    let mut groups_by_name: HashMap<String, Uuid> = HashMap::new();
    for group in &store.groups {
        groups_by_name.insert(group.name.to_lowercase(), group.id);
    }
    // File group id -> the group id it maps to in the store under construction.
    let mut file_group_to_store: HashMap<Uuid, Uuid> = HashMap::new();
    for group in &file.groups {
        let key = group.name.trim().to_lowercase();
        let id = match groups_by_name.get(&key) {
            Some(id) => *id,
            None => {
                let (store, created) = next.create_group(
                    &GroupInput {
                        name: group.name.clone(),
                        color: group.color,
                    },
                    new_id(),
                )?;
                next = store;
                report.groups_created += 1;
                groups_by_name.insert(key, created.id);
                created.id
            }
        };
        file_group_to_store.insert(group.id, id);
    }

    // File connection id -> the connection id in the store (added or already here).
    let mut file_connection_to_store: HashMap<Uuid, Uuid> = HashMap::new();
    // Added connection -> (file id of its bastion, the input it was created with).
    let mut bastion_of: HashMap<Uuid, (Option<Uuid>, ConnectionInput)> = HashMap::new();

    // 3. Connections, without their bastion yet.
    for connection in &file.connections {
        let present = next
            .connections
            .iter()
            .find(|c| same_connection(c, connection));
        if let Some(present) = present {
            report.skipped += 1;
            file_connection_to_store.insert(connection.id, present.id);
            continue;
        }

        let mut input = connection.to_input();
        input.group_id = connection
            .group_id
            .as_ref()
            .and_then(|id| file_group_to_store.get(id).copied());
        input.jump_host_id = None;
        match next.create_connection(&input, new_id(), now_ms) {
            Ok((store, created)) => {
                next = store;
                report.added += 1;
                file_connection_to_store.insert(connection.id, created.id);
                bastion_of.insert(created.id, (connection.jump_host_id, input.clone()));
            }
            Err(_) => report.invalid += 1,
        }
    }

    // 4. Re-link each added connection to its bastion's new id.
    for (added_id, (bastion_file_id, mut input)) in bastion_of {
        let Some(bastion_file_id) = bastion_file_id else {
            continue;
        };
        let Some(bastion_store_id) = file_connection_to_store.get(&bastion_file_id) else {
            continue;
        };
        // The bastion is the connection itself: it can no longer be a jump host.
        if *bastion_store_id == added_id {
            continue;
        }
        input.jump_host_id = Some(*bastion_store_id);
        // A bastion that became invalid (cycle, ...) leaves the direct connection, without error.
        if let Ok((store, _)) = next.update_connection(added_id, &input, now_ms) {
            next = store;
        }
    }

    Ok((next, report))
}
