use serde_json::Value;

use crate::error::{AppError, AppResult, ErrorKind};
use crate::store::STORE_VERSION;

/// Upgrades a parsed `connections.json` to the current on-disk version.
///
/// The version is read before any typed deserialization (docs/05-modele-donnees.md §4): a file
/// from a newer TunL is refused with `ErrorKind::Store` and left untouched, never quarantined.
/// Versions at or below the current one are returned once bumped up to `STORE_VERSION`.
pub fn migrate_to_current(value: serde_json::Value) -> AppResult<serde_json::Value> {
    let version = value
        .get("version")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| AppError::new(ErrorKind::Store, "missing version"))?;

    if version > STORE_VERSION as u64 {
        return Err(AppError::new(
            ErrorKind::Store,
            format!("created by a newer TunL (version {version})"),
        ));
    }

    let mut value = value;
    let mut current = version;
    while current < STORE_VERSION as u64 {
        // There is only one format today, so a step only bumps the version number. The next
        // `connections.json` format would transform the data here before bumping it.
        current += 1;
        value["version"] = Value::from(current);
    }
    Ok(value)
}
