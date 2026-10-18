use std::collections::{HashMap, HashSet};
use std::net::{Ipv4Addr, Ipv6Addr};

use uuid::Uuid;

use super::validate_args::{normalize_rdp_settings, normalize_ssh_settings};
use super::{Connection, ConnectionInput, Group, Protocol, ProtocolSettings, WolConfig};
use crate::error::{AppError, AppResult, ErrorDetail, ErrorKind};

/// Maximum number of bastions in a jump chain.
pub const MAX_JUMP_HOSTS: usize = 4;

/// Returns a NEW, normalized copy of `input`, or the first validation error found.
///
/// `self_id` is `Some` when updating an existing connection. `groups` / `connections` are the current store.
/// The input itself is never mutated.
pub fn normalize_connection_input(
    input: &ConnectionInput,
    self_id: Option<Uuid>,
    groups: &[Group],
    connections: &[Connection],
) -> AppResult<ConnectionInput> {
    let name = validate_name("name", &input.name)?;
    let host = validate_host("host", &input.host)?;
    let port = validate_port("port", input.port)?;
    let username = normalize_optional("username", input.username.as_deref(), 128)?;
    let notes = normalize_optional("notes", input.notes.as_deref(), 2000)?;
    let tags = normalize_tags("tags", &input.tags)?;

    if let Some(group_id) = input.group_id
        && !groups.iter().any(|g| g.id == group_id)
    {
        return Err(AppError::validation(
            "groupId",
            "referenced group does not exist",
        ));
    }

    // Jump host chain, replacing the stored `self_id` with the input being validated.
    let mut map: HashMap<Uuid, Connection> =
        connections.iter().map(|c| (c.id, c.clone())).collect();
    if let Some(sid) = self_id {
        map.insert(sid, Connection::from_input(sid, input.clone(), 0));
    }
    validate_jump_chain(input.jump_host_id, &map)?;

    let wol = match &input.wol {
        Some(config) => Some(normalize_wol(config)?),
        None => None,
    };

    let settings = match &input.settings {
        ProtocolSettings::Ssh(settings) => ProtocolSettings::Ssh(normalize_ssh_settings(settings)?),
        ProtocolSettings::Rdp(settings) => ProtocolSettings::Rdp(normalize_rdp_settings(settings)?),
    };

    // A bastion turned into RDP cannot keep serving connections that jump through it.
    if matches!(settings, ProtocolSettings::Rdp(_))
        && let Some(sid) = self_id
    {
        let used_by: Vec<String> = connections
            .iter()
            .filter(|c| c.id != sid && c.jump_host_id == Some(sid))
            .map(|c| c.name.clone())
            .collect();
        if !used_by.is_empty() {
            let mut names = used_by;
            names.sort();
            return Err(
                AppError::new(ErrorKind::InUse, "protocol: used as a jump host")
                    .with_detail(ErrorDetail::InUse { names }),
            );
        }
    }

    Ok(ConnectionInput {
        name,
        host,
        port,
        username,
        group_id: input.group_id,
        tags,
        favorite: input.favorite,
        color: input.color,
        notes,
        jump_host_id: input.jump_host_id,
        wol,
        settings,
    })
}

fn normalize_wol(config: &WolConfig) -> AppResult<WolConfig> {
    let mac = normalize_mac(config.mac.trim())
        .ok_or_else(|| AppError::validation("wol.mac", "must be a valid MAC address"))?;
    if config.broadcast.trim().parse::<Ipv4Addr>().is_err() {
        return Err(AppError::validation(
            "wol.broadcast",
            "must be a valid IPv4 address",
        ));
    }
    if !(1..=65535).contains(&config.port) {
        return Err(AppError::validation(
            "wol.port",
            "must be between 1 and 65535",
        ));
    }
    if !(10..=600).contains(&config.wait_timeout_secs) {
        return Err(AppError::validation(
            "wol.waitTimeoutSecs",
            "must be between 10 and 600 seconds",
        ));
    }
    Ok(WolConfig {
        mac,
        broadcast: config.broadcast.clone(),
        port: config.port,
        wake_before_connect: config.wake_before_connect,
        wait_timeout_secs: config.wait_timeout_secs,
    })
}

fn validate_jump_chain(start: Option<Uuid>, map: &HashMap<Uuid, Connection>) -> AppResult<()> {
    let mut current = start;
    let mut visited: HashSet<Uuid> = HashSet::new();
    let mut count = 0usize;
    while let Some(id) = current {
        if visited.contains(&id) {
            return Err(AppError::validation(
                "jumpHostId",
                "the jump host chain loops back to a previously visited bastion",
            ));
        }
        let hop = match map.get(&id) {
            Some(hop) => hop,
            None => {
                return Err(AppError::validation(
                    "jumpHostId",
                    "the jump host does not exist",
                ));
            }
        };
        if hop.settings.protocol() != Protocol::Ssh {
            return Err(AppError::validation(
                "jumpHostId",
                "the jump host must be an SSH connection",
            ));
        }
        visited.insert(id);
        count += 1;
        if count > MAX_JUMP_HOSTS {
            return Err(AppError::validation(
                "jumpHostId",
                "the jump host chain may contain at most 4 bastions",
            ));
        }
        current = hop.jump_host_id;
    }
    Ok(())
}

/// `raw`, trimmed: 1–80 characters, no control character.
fn validate_name(field: &str, raw: &str) -> AppResult<String> {
    let value = raw.trim();
    if value.chars().count() < 1 {
        return Err(AppError::validation(field, "must not be empty"));
    }
    if value.chars().count() > 80 {
        return Err(AppError::validation(field, "must be at most 80 characters"));
    }
    if value.chars().any(char::is_control) {
        return Err(AppError::validation(
            field,
            "must not contain control characters",
        ));
    }
    Ok(value.to_string())
}

/// Trimmed host: 1–253 characters, IPv4, IPv6 without brackets, or a host name.
fn validate_host(field: &str, raw: &str) -> AppResult<String> {
    let value = raw.trim();
    if value.chars().count() < 1 {
        return Err(AppError::validation(field, "must not be empty"));
    }
    if value.chars().count() > 253 {
        return Err(AppError::validation(
            field,
            "must be at most 253 characters",
        ));
    }
    if value.chars().any(char::is_control) {
        return Err(AppError::validation(
            field,
            "must not contain control characters",
        ));
    }
    if value.parse::<Ipv4Addr>().is_ok()
        || value.parse::<Ipv6Addr>().is_ok()
        || is_valid_hostname(value)
    {
        return Ok(value.to_string());
    }
    Err(AppError::validation(
        field,
        "must be a valid IPv4, IPv6 address or host name",
    ))
}

fn is_valid_hostname(value: &str) -> bool {
    value.split('.').all(|label| {
        let len = label.chars().count();
        (1..=63).contains(&len)
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    })
}

fn validate_port(field: &str, port: u16) -> AppResult<u16> {
    if port < 1 {
        return Err(AppError::validation(field, "must be between 1 and 65535"));
    }
    Ok(port)
}

/// Trimmed optional string; empty after trim becomes `None`.
fn normalize_optional(field: &str, raw: Option<&str>, max: usize) -> AppResult<Option<String>> {
    match raw {
        None => Ok(None),
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                return Ok(None);
            }
            if trimmed.chars().count() > max {
                return Err(AppError::validation(
                    field,
                    &format!("must be at most {max} characters"),
                ));
            }
            if trimmed.chars().any(char::is_control) {
                return Err(AppError::validation(
                    field,
                    "must not contain control characters",
                ));
            }
            Ok(Some(trimmed.to_string()))
        }
    }
}

/// Each tag trimmed and lowercased, deduplicated keeping the first, 1–24 characters of `[a-z0-9._-]`, at most 10.
fn normalize_tags(field: &str, tags: &[String]) -> AppResult<Vec<String>> {
    let mut out: Vec<String> = Vec::new();
    for tag in tags {
        let cleaned = tag.trim().to_ascii_lowercase();
        if cleaned.chars().count() < 1 {
            return Err(AppError::validation(field, "a tag must not be empty"));
        }
        if cleaned.chars().count() > 24 {
            return Err(AppError::validation(
                field,
                "a tag must be at most 24 characters",
            ));
        }
        if !cleaned
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
        {
            return Err(AppError::validation(
                field,
                "a tag may only contain letters, digits, '.', '_' and '-'",
            ));
        }
        if !out.contains(&cleaned) {
            out.push(cleaned);
        }
    }
    if out.len() > 10 {
        return Err(AppError::validation(field, "at most 10 tags are allowed"));
    }
    Ok(out)
}

/// `AA:BB:CC:DD:EE:FF` from 12 glued hex digits or 6 pairs separated by a single `:` or `-`, else `None`.
pub fn normalize_mac(raw: &str) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    let parts: Vec<&str> = if raw.contains(':') {
        raw.split(':').collect()
    } else if raw.contains('-') {
        raw.split('-').collect()
    } else {
        vec![raw]
    };
    let bytes = match parts.len() {
        6 => {
            let mut bytes = [0u8; 6];
            for (i, part) in parts.iter().enumerate() {
                if part.len() != 2 {
                    return None;
                }
                bytes[i] = u8::from_str_radix(part, 16).ok()?;
            }
            bytes
        }
        1 => {
            if raw.len() != 12 {
                return None;
            }
            let mut bytes = [0u8; 6];
            for (i, chunk) in raw.as_bytes().chunks(2).enumerate() {
                let pair = std::str::from_utf8(chunk).ok()?;
                bytes[i] = u8::from_str_radix(pair, 16).ok()?;
            }
            bytes
        }
        _ => return None,
    };
    Some(
        (0..6)
            .map(|i| format!("{:02X}", bytes[i]))
            .collect::<Vec<_>>()
            .join(":"),
    )
}
