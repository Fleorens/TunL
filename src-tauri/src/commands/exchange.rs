//! The export and import commands. They read and write the file themselves (never trust the UI),
//! and never let a secret reach a log or an error message (S7, S9).
//!
//! The export writes one JSON file of the whole store (no password, S1). The import fuses it into
//! the current store: nothing is overwritten, a connection already here is left aside, and every
//! new connection gets a fresh id.

use std::fs;
use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::State;
use uuid::Uuid;

use crate::clock::now_ms;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::store::exchange::{export_file, plan_import, ExportFile, ImportReport};

/// Exported files past this size are refused before they are read into memory (5 MiB).
const MAX_EXPORT_BYTES: u64 = 5 * 1024 * 1024;

/// A path the user gave: it must be absolute, or the command refuses it (a relative one depends on
/// the process working directory, which the UI cannot control).
fn require_absolute(path: &str) -> AppResult<PathBuf> {
    let candidate = Path::new(path);
    if !candidate.is_absolute() {
        return Err(AppError::validation("path", "must be absolute"));
    }
    Ok(candidate.to_path_buf())
}

/// Write `value` as pretty JSON (indent + trailing newline) to `path`, atomically, at mode 0600
/// (S9). No `.bak`: the file lives beside the user, not in TunL's own directory.
fn write_export(path: &Path, value: &impl Serialize) -> AppResult<()> {
    let tmp = with_suffix(path, ".tmp");

    // `create_new` (not `truncate`) so the mode below always applies: an existing `.tmp` left by a
    // crash would keep its old permissions otherwise (S9). Remove a leftover one first.
    let _ = fs::remove_file(&tmp);
    let mut tmp_file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&tmp)?;
    let mut bytes = serde_json::to_vec_pretty(value)?;
    bytes.push(b'\n');
    tmp_file.write_all(&bytes)?;
    tmp_file.sync_all()?;

    // The main file exists at every instant: rename the finished `.tmp` over it, then sync the
    // directory so the rename survives a power cut.
    fs::rename(&tmp, path)?;
    if let Some(dir) = path.parent() {
        if let Ok(dir_file) = fs::File::open(dir) {
            let _ = dir_file.sync_all();
        }
    }
    Ok(())
}

/// Suffix `path` (e.g. `export.json` → `export.json.tmp`), pushed onto the OS string so non-UTF-8
/// paths are not lossy.
fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(suffix);
    PathBuf::from(name)
}

/// Export the whole store to `path`, returning how many connections went into the file.
#[tauri::command]
pub async fn store_export(state: State<'_, AppState>, path: String) -> AppResult<u32> {
    let path = require_absolute(&path)?;
    let store = state.read_store().await?;
    let file = export_file(&store, now_ms());
    let count = store.connections.len() as u32;
    write_export(&path, &file)?;
    log::info!("exported {} connections to {}", count, path.display());
    Ok(count)
}

/// Import the file at `path`, fusing it into the current store and reporting what changed.
#[tauri::command]
pub async fn store_import(state: State<'_, AppState>, path: String) -> AppResult<ImportReport> {
    let path = require_absolute(&path)?;
    let metadata = fs::metadata(&path).map_err(|error| match error.kind() {
        std::io::ErrorKind::NotFound => AppError::not_found(format!("export {}", path.display())),
        _ => AppError::internal("cannot read the export"),
    })?;
    if metadata.len() > MAX_EXPORT_BYTES {
        return Err(AppError::validation("path", "file is too large"));
    }

    // A file TunL did not write is not a TunL export: refuse it without echoing its content (S7).
    let text = fs::read_to_string(&path).map_err(|_| {
        AppError::validation("path", "is not a TunL export")
    })?;
    let file: ExportFile = serde_json::from_str(&text).map_err(|_| {
        AppError::validation("path", "is not a TunL export")
    })?;

    let report = state
        .mutate(|store| plan_import(store, &file, now_ms(), Uuid::new_v4))
        .await?;
    log::info!(
        "imported {}: {} added, {} already here, {} refused",
        path.display(),
        report.added,
        report.skipped,
        report.invalid,
    );
    Ok(report)
}
