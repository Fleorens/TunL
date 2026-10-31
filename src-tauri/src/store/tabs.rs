use std::path::Path;

use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;

use super::file;
use crate::error::{AppError, AppResult};

/// One tab to reopen: a saved connection and what the tab ran. Never a quick target, never a secret.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SavedTab {
    pub connection_id: Uuid,
    pub kind: SavedTabKind,
}

/// What one saved tab ran: a shell, a file explorer, or a desktop.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum SavedTabKind {
    Ssh,
    Sftp,
    Rdp,
}

/// The most tabs kept, so a long session list cannot grow the file without bound.
pub const MAX_SAVED_TABS: usize = 50;

/// The on-disk shape of `tabs.json`: versioned and camelCase (docs/05-modele-donnees.md §4).
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TabsFile {
    version: u32,
    tabs: Vec<SavedTab>,
}

/// The only `tabs.json` version TunL writes.
const TABS_VERSION: u32 = 1;

/// The tabs saved last time, in order. A missing file, an unreadable one, or one of a newer version:
/// none (with a `log::warn!` for the last two), never an error.
pub fn load_tabs(config_dir: &Path) -> Vec<SavedTab> {
    let path = config_dir.join("tabs.json");
    let Ok(contents) = std::fs::read_to_string(&path) else {
        // A missing file is nothing to warn about.
        return Vec::new();
    };
    let raw: TabsFile = match serde_json::from_str(&contents) {
        Ok(raw) => raw,
        Err(_) => {
            log::warn!("{path:?} was unreadable, reopening nothing");
            return Vec::new();
        }
    };
    if raw.version > TABS_VERSION {
        log::warn!("{path:?} is from a newer TunL, reopening nothing");
        return Vec::new();
    }
    raw.tabs
}

/// Replace `tabs.json` (`{ "version": 1, "tabs": [...] }`, mode 0600). More than `MAX_SAVED_TABS`:
/// `AppError::validation("tabs", …)`, nothing written.
pub fn save_tabs(config_dir: &Path, tabs: &[SavedTab]) -> AppResult<()> {
    if tabs.len() > MAX_SAVED_TABS {
        return Err(AppError::validation(
            "tabs",
            &format!("too many tabs (more than {MAX_SAVED_TABS})"),
        ));
    }
    let path = config_dir.join("tabs.json");
    file::write_json_atomic(
        &path,
        &TabsFile {
            version: TABS_VERSION,
            tabs: tabs.to_vec(),
        },
    )
}
