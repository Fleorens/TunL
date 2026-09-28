//! Turn a parsed `~/.ssh/config` into import candidates, and apply the import.
//!
//! Pure: it never touches disk. `build_candidates` previews an import; `apply_import`
//! returns a NEW store (never mutating the original), bastions before their jumpers.
//!
//! docs/06-securite.md §S12 — nothing is executed, only described.

use std::collections::{HashMap, HashSet};

use serde::Serialize;
use ts_rs::TS;
use uuid::Uuid;

use super::ssh_config::{ParsedSshConfig, SshConfigHost};
use crate::error::AppResult;
use crate::model::{
    Connection, ConnectionInput, Protocol, ProtocolSettings, SshAuth, SshSettings,
    normalize_connection_input,
};
use crate::store::Store;

/// The identity fields `base_fields` returns, as one named type.
type BaseFields = (
    String,
    String,
    u16,
    Option<String>,
    Option<String>,
    Vec<String>,
    Option<String>,
);
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum ImportJump {
    Candidate { alias: String },
    Existing { id: Uuid, name: String },
    Unresolved { hop: String },
}
/// One importable host, with everything the UI shows and needs to apply it.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ImportCandidate {
    /// A concrete name from a `Host` line.
    pub alias: String,
    /// `HostName`, or the alias when absent.
    pub host: String,
    /// Port, or 22.
    pub port: u16,
    pub username: Option<String>,
    /// `IdentityFile`, as written (`~` kept).
    pub key_path: Option<String>,
    pub jump: Option<ImportJump>,
    /// An existing connection of the same host (case-insensitive), port and username.
    pub duplicate_of: Option<Uuid>,
    /// Host-level warnings (ignored options, unsupported tokens, …).
    pub warnings: Vec<String>,
    /// `Some(message)` when the import would fail validation; the UI never lets it be selected.
    pub error: Option<String>,
}
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ImportPreview {
    pub path: String,
    pub candidates: Vec<ImportCandidate>,
    pub warnings: Vec<String>,
}
pub fn build_candidates(parsed: &ParsedSshConfig, store: &Store) -> Vec<ImportCandidate> {
    let mut candidates: Vec<ImportCandidate> = Vec::with_capacity(parsed.hosts.len());
    let mut last_hops: Vec<Option<String>> = Vec::with_capacity(parsed.hosts.len());

    for host in &parsed.hosts {
        let (alias, host_name, port, username, key_path, warnings, last_hop) = base_fields(host);
        let error = candidate_error(&alias, &host_name, port, &username, &key_path, store);
        let duplicate_of = find_duplicate(&host_name, port, username.as_deref(), store);
        last_hops.push(last_hop);
        candidates.push(ImportCandidate {
            alias: alias.clone(),
            host: host_name,
            port,
            username: username.clone(),
            key_path: key_path.clone(),
            jump: None,
            duplicate_of,
            warnings,
            error,
        });
    }
    for (index, _host) in parsed.hosts.iter().enumerate() {
        if let Some(raw) = &last_hops[index] {
            let jump = resolve_jump(index, raw, &candidates, store);
            if matches!(jump, Some(ImportJump::Unresolved { .. })) {
                candidates[index]
                    .warnings
                    .push(format!("jump host {raw} not found"));
            }
            candidates[index].jump = jump;
        }
    }
    candidates
}
fn base_fields(host: &SshConfigHost) -> BaseFields {
    let mut warnings = host.warnings.clone();
    let last_hop = match host.proxy_jump.last() {
        Some(last) => {
            if host.proxy_jump.len() > 1 {
                warnings.push("only the last ProxyJump hop is used".to_string());
            }
            Some(last.clone())
        }
        None => None,
    };
    (
        host.alias.clone(),
        host.host_name.clone().unwrap_or_else(|| host.alias.clone()),
        host.port.unwrap_or(22),
        host.user.clone(),
        host.identity_file.clone(),
        warnings,
        last_hop,
    )
}
fn candidate_error(
    alias: &str,
    host: &str,
    port: u16,
    username: &Option<String>,
    key_path: &Option<String>,
    store: &Store,
) -> Option<String> {
    let input = connection_input(
        alias,
        host.to_string(),
        port,
        username.clone(),
        key_path.clone(),
        None,
    );
    normalize_connection_input(&input, None, &store.groups, &store.connections)
        .err()
        .map(|error| error.message)
}
fn find_duplicate(host: &str, port: u16, username: Option<&str>, store: &Store) -> Option<Uuid> {
    store
        .connections
        .iter()
        .find(|connection| {
            connection.host.eq_ignore_ascii_case(host)
                && connection.port == port
                && connection.username.as_deref() == username
        })
        .map(|connection| connection.id)
}
fn connection_input(
    alias: &str,
    host: String,
    port: u16,
    username: Option<String>,
    key_path: Option<String>,
    group_id: Option<Uuid>,
) -> ConnectionInput {
    let auth = match &key_path {
        Some(path) => SshAuth::Key { path: path.clone() },
        None => SshAuth::Agent,
    };
    ConnectionInput {
        name: alias.to_string(),
        host,
        port,
        username,
        group_id,
        tags: Vec::new(),
        favorite: false,
        color: None,
        notes: None,
        jump_host_id: None,
        wol: None,
        settings: ProtocolSettings::Ssh(SshSettings {
            auth,
            keepalive_secs: None,
            connect_timeout_secs: None,
        }),
    }
}
fn resolve_jump(
    index: usize,
    raw: &str,
    candidates: &[ImportCandidate],
    store: &Store,
) -> Option<ImportJump> {
    let target = parse_jump(raw);
    // No `[user@]` and no `:port`: match another candidate's alias.
    let same_alias = if target.user.is_none() && target.port.is_none() {
        candidates
            .iter()
            .enumerate()
            .find(|(i, candidate)| *i != index && candidate.alias == target.raw)
    } else {
        None
    };
    if let Some(other) = same_alias {
        return match &other.1.duplicate_of {
            Some(existing_id) => {
                let name = store
                    .connections
                    .iter()
                    .find(|connection| connection.id == *existing_id)
                    .map(|connection| connection.name.clone())
                    .unwrap_or_else(|| other.1.alias.clone());
                Some(ImportJump::Existing {
                    id: *existing_id,
                    name,
                })
            }
            None => Some(ImportJump::Candidate {
                alias: other.1.alias.clone(),
            }),
        };
    }
    for connection in &store.connections {
        if connection.settings.protocol() != Protocol::Ssh {
            continue;
        }
        if connection.name == target.raw
            || (connection.host == target.host
                && target.port.is_none_or(|port| connection.port == port))
        {
            return Some(ImportJump::Existing {
                id: connection.id,
                name: connection.name.clone(),
            });
        }
    }
    Some(ImportJump::Unresolved {
        hop: raw.to_string(),
    })
}
struct JumpTarget {
    raw: String,
    user: Option<String>,
    host: String,
    port: Option<u16>,
}
fn parse_jump(raw: &str) -> JumpTarget {
    let (head, port) = match raw.rsplit_once(':') {
        Some((head, port)) => (head, port.parse::<u16>().ok()),
        None => (raw, None),
    };
    match head.split_once('@') {
        Some((user, host)) => JumpTarget {
            raw: raw.to_string(),
            user: Some(user.to_string()),
            host: host.to_string(),
            port,
        },
        None => JumpTarget {
            raw: raw.to_string(),
            user: None,
            host: head.to_string(),
            port,
        },
    }
}
pub fn apply_import(
    store: &Store,
    candidates: &[ImportCandidate],
    selected: &[String],
    group_id: Option<Uuid>,
    now_ms: i64,
    mut new_id: impl FnMut() -> Uuid,
) -> AppResult<(Store, Vec<Connection>)> {
    let selected_set: HashSet<&str> = selected.iter().map(String::as_str).collect();
    let importable: Vec<usize> = candidates
        .iter()
        .enumerate()
        .filter(|(_, candidate)| {
            selected_set.contains(candidate.alias.as_str()) && candidate.error.is_none()
        })
        .map(|(index, _)| index)
        .collect();

    let mut store = store.clone();
    let mut created: Vec<Connection> = Vec::new();
    let mut alias_id: HashMap<String, Uuid> = HashMap::new();
    let mut pending = importable;

    loop {
        let mut made_progress = false;
        let mut still_pending: Vec<usize> = Vec::new();

        for &index in &pending {
            match bastion_for(index, candidates, &selected_set, &alias_id) {
                Bastion::Ready(jump_host_id) => {
                    let connection = create_one(
                        &mut store,
                        &candidates[index],
                        group_id,
                        jump_host_id,
                        now_ms,
                        &mut new_id,
                    )?;
                    alias_id.insert(candidates[index].alias.clone(), connection.id);
                    created.push(connection);
                    made_progress = true;
                }
                Bastion::Pending => still_pending.push(index),
            }
        }
        pending = still_pending;
        if pending.is_empty() {
            break;
        }
        if made_progress {
            continue;
        }
        let index = pending.remove(0);
        let connection = create_one(
            &mut store,
            &candidates[index],
            group_id,
            existing_bastion(&candidates[index].jump),
            now_ms,
            &mut new_id,
        )?;
        alias_id.insert(candidates[index].alias.clone(), connection.id);
        created.push(connection);
    }

    Ok((store, created))
}
enum Bastion {
    Ready(Option<Uuid>),
    Pending,
}
fn bastion_for(
    index: usize,
    candidates: &[ImportCandidate],
    selected_set: &HashSet<&str>,
    alias_id: &HashMap<String, Uuid>,
) -> Bastion {
    match &candidates[index].jump {
        None | Some(ImportJump::Unresolved { .. }) => Bastion::Ready(None),
        Some(ImportJump::Existing { id, .. }) => Bastion::Ready(Some(*id)),
        Some(ImportJump::Candidate { alias }) => {
            if selected_set.contains(alias.as_str()) && is_importable(alias, candidates) {
                match alias_id.get(alias) {
                    Some(id) => Bastion::Ready(Some(*id)),
                    None => Bastion::Pending,
                }
            } else {
                Bastion::Ready(None)
            }
        }
    }
}
fn is_importable(alias: &str, candidates: &[ImportCandidate]) -> bool {
    candidates
        .iter()
        .any(|candidate| candidate.alias == alias && candidate.error.is_none())
}
fn existing_bastion(jump: &Option<ImportJump>) -> Option<Uuid> {
    match jump {
        Some(ImportJump::Existing { id, .. }) => Some(*id),
        _ => None,
    }
}
fn create_one(
    store: &mut Store,
    candidate: &ImportCandidate,
    group_id: Option<Uuid>,
    jump_host_id: Option<Uuid>,
    now_ms: i64,
    new_id: &mut impl FnMut() -> Uuid,
) -> AppResult<Connection> {
    let input = connection_input(
        &candidate.alias,
        candidate.host.clone(),
        candidate.port,
        candidate.username.clone(),
        candidate.key_path.clone(),
        group_id,
    );
    let input = ConnectionInput {
        jump_host_id,
        ..input
    };
    let id = new_id();
    let (next, connection) = store.create_connection(&input, id, now_ms)?;
    *store = next;
    Ok(connection)
}
