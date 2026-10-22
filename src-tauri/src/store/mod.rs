use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult, ErrorKind};
use crate::model::{Connection, Group, Settings, normalize_settings};

pub mod exchange;
pub mod file;
mod migrate;
pub mod ops;

pub use migrate::migrate_to_current;

#[cfg(test)]
mod exchange_tests;
#[cfg(test)]
mod exchange_untrusted_tests;
#[cfg(test)]
mod ops_tests;

/// File name of the connections store, inside the config directory (docs/01-architecture.md §9).
pub const STORE_FILE: &str = "connections.json";
/// File name of the settings store.
pub const SETTINGS_FILE: &str = "settings.json";
/// The only `connections.json` format TunL knows how to read.
pub const STORE_VERSION: u32 = 1;

/// The in-memory store. Never mutated in place: every change builds a new Store (T08).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Store {
    pub groups: Vec<Group>,
    pub connections: Vec<Connection>,
}

/// A store read from disk. `quarantined` is set when the file was unreadable and moved aside.
#[derive(Debug, Default)]
pub struct Loaded<T> {
    pub value: T,
    pub quarantined: Option<PathBuf>,
}

/// On-disk shape of `connections.json`: versioned and camelCase (docs/05-modele-donnees.md §4).
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoreFile {
    version: u32,
    groups: Vec<Group>,
    connections: Vec<Connection>,
}

/// Loads `connections.json`, quarantining an unreadable file and refusing a newer version.
pub fn load_store(config_dir: &Path, now_ms: i64) -> AppResult<Loaded<Store>> {
    let path = config_dir.join(STORE_FILE);
    if !path.exists() {
        return Ok(Loaded {
            value: Store::default(),
            quarantined: None,
        });
    }

    // Read the version before any typed deserialization, so a `version: 99` file with a changed
    // shape is refused as "newer" (docs/05-modele-donnees.md §4) instead of landing in quarantine.
    let contents = file::read(&path)?;
    let raw = match serde_json::from_str(&contents) {
        Ok(raw) => raw,
        Err(_) => return quarantine_then_default::<Store>(&path, now_ms),
    };
    match version_of(&raw) {
        Some(version) if version > STORE_VERSION as u64 => {
            return Err(AppError::new(
                ErrorKind::Store,
                format!("{STORE_FILE} was created by a newer TunL (version {version})"),
            ));
        }
        _ => {}
    }

    match serde_json::from_value::<StoreFile>(raw) {
        Ok(file) => {
            tighten_permissions(&path)?;
            Ok(Loaded {
                value: Store {
                    groups: file.groups,
                    connections: file.connections,
                },
                quarantined: None,
            })
        }
        Err(_) => quarantine_then_default::<Store>(&path, now_ms),
    }
}

/// Writes `store` to `connections.json`.
pub fn save_store(config_dir: &Path, store: &Store) -> AppResult<()> {
    let path = config_dir.join(STORE_FILE);
    let file = StoreFile {
        version: STORE_VERSION,
        groups: store.groups.clone(),
        connections: store.connections.clone(),
    };
    file::write_json_atomic(&path, &file)
}

/// Loads `settings.json`: missing fields default, unknown fields are ignored, and an out-of-range
/// value is treated like an unreadable file (quarantined, then reset to defaults).
pub fn load_settings(config_dir: &Path, now_ms: i64) -> AppResult<Loaded<Settings>> {
    let path = config_dir.join(SETTINGS_FILE);
    if !path.exists() {
        return Ok(Loaded {
            value: Settings::default(),
            quarantined: None,
        });
    }

    let contents = file::read(&path)?;
    let settings: Settings = match serde_json::from_str(&contents) {
        Ok(settings) => settings,
        Err(_) => return quarantine_then_default::<Settings>(&path, now_ms),
    };
    let settings = match normalize_settings(&settings) {
        Ok(settings) => settings,
        Err(_) => return quarantine_then_default::<Settings>(&path, now_ms),
    };

    Ok(Loaded {
        value: settings,
        quarantined: None,
    })
}

/// Writes `settings` to `settings.json`.
pub fn save_settings(config_dir: &Path, settings: &Settings) -> AppResult<()> {
    let path = config_dir.join(SETTINGS_FILE);
    file::write_json_atomic(&path, settings)
}

/// Peeks the `version` field as a non-negative integer, before any typed deserialization.
fn version_of(raw: &serde_json::Value) -> Option<u64> {
    raw.get("version").and_then(serde_json::Value::as_u64)
}

/// Moves an unreadable file aside and returns the default value for `T`.
fn quarantine_then_default<T: Default>(path: &Path, now_ms: i64) -> AppResult<Loaded<T>> {
    let quarantined = file::quarantine(path, now_ms)?;
    log::warn!("{path:?} was unreadable and moved aside to {quarantined:?}; starting empty");
    Ok(Loaded {
        value: T::default(),
        quarantined: Some(quarantined),
    })
}

/// Forces mode 0600 on an existing store file when it is looser (docs/06-securite.md, S9).
fn tighten_permissions(path: &Path) -> AppResult<()> {
    if fs::metadata(path)?.permissions().mode() & 0o777 != 0o600 {
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests;
