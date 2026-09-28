//! The two import commands. They read and re-parse the file themselves (never trust the UI, S12),
//! preview what an import would do, and apply it by building a NEW store (the original is mutated in
//! place nowhere). Nothing the file contains reaches a log or an error message (S7, S8).
//!
//! docs/06-securite.md §S12.

use std::io;
use std::path::{Path, PathBuf};

use tauri::State;
use uuid::Uuid;

use crate::clock::now_ms;
use crate::commands::store::StoreSnapshot;
use crate::error::{AppError, AppResult};
use crate::import::plan::{ImportPreview, apply_import, build_candidates};
use crate::import::ssh_config::{ParsedSshConfig, parse_ssh_config, wildcard_match};
use crate::state::AppState;

/// A config file past this size is rejected before it is read into memory.
const MAX_FILE_BYTES: u64 = 1024 * 1024;

/// Preview an import: parse the file, build the candidates against the current store.
#[tauri::command]
pub async fn import_ssh_config_preview(
    state: State<'_, AppState>,
    path: Option<String>,
) -> AppResult<ImportPreview> {
    let (parsed, display) = read_and_parse(path.as_deref())?;
    let store = state.read_store().await?;
    Ok(ImportPreview {
        path: display,
        candidates: build_candidates(&parsed, &store),
        warnings: parsed.warnings,
    })
}

/// Apply the selected candidates: re-read, rebuild them, then `state.mutate` with `apply_import`.
#[tauri::command]
pub async fn import_ssh_config_apply(
    state: State<'_, AppState>,
    path: Option<String>,
    aliases: Vec<String>,
    group_id: Option<Uuid>,
) -> AppResult<StoreSnapshot> {
    let (parsed, _display) = read_and_parse(path.as_deref())?;
    let store = state.read_store().await?;
    let candidates = build_candidates(&parsed, &store);

    let now = now_ms();
    let created = state
        .mutate(|store| apply_import(store, &candidates, &aliases, group_id, now, Uuid::new_v4))
        .await?;
    log::info!("imported {} connections from ssh config", created.len());

    let store = state.read_store().await?;
    Ok(StoreSnapshot {
        groups: store.groups.clone(),
        connections: store.connections.clone(),
        quarantined: state.quarantined.clone(),
    })
}

/// Read the file, expand its `Include` arguments, and parse. Returns the parsed config and the path
/// as read, with the home directory written as `~`.
fn read_and_parse(path: Option<&str>) -> AppResult<(ParsedSshConfig, String)> {
    let home = std::env::home_dir()
        .ok_or_else(|| AppError::internal("cannot determine the home directory"))?;
    let ssh_dir = home.join(".ssh");
    let root = resolve_root(&home, path)?;
    let text = read_file(&root)?;
    let display = to_display_path(&root, &home);

    // `include(arg)` turns an Include argument into the (path, text) of every file it matches.
    let include = |arg: &str| resolve_include(&home, &ssh_dir, arg);
    let parsed = parse_ssh_config(&text, &include);
    Ok((parsed, display))
}

/// The file to read: the default `~/.ssh/config`, or a given absolute path. Checks existence and size.
fn resolve_root(home: &Path, path: Option<&str>) -> AppResult<PathBuf> {
    let root = match path {
        None => home.join(".ssh").join("config"),
        Some(path) => {
            let candidate = PathBuf::from(path);
            if !candidate.is_absolute() {
                return Err(AppError::validation("path", "must be absolute"));
            }
            candidate
        }
    };
    let metadata = std::fs::metadata(&root).map_err(|error| match error.kind() {
        io::ErrorKind::NotFound => AppError::not_found(format!("ssh config {}", root.display())),
        _ => AppError::internal("cannot read the ssh config"),
    })?;
    if metadata.len() > MAX_FILE_BYTES {
        return Err(AppError::validation("path", "file is too large"));
    }
    Ok(root)
}

fn read_file(root: &Path) -> AppResult<String> {
    std::fs::read_to_string(root).map_err(|error| match error.kind() {
        io::ErrorKind::NotFound => AppError::not_found(format!("ssh config {}", root.display())),
        _ => AppError::internal("cannot read the ssh config"),
    })
}

/// `path` with the home directory prefix written as `~`, for display only.
fn to_display_path(root: &Path, home: &Path) -> String {
    match root.strip_prefix(home) {
        Ok(relative) => format!("~{}", relative.display()),
        Err(_) => root.display().to_string(),
    }
}

/// The files an `Include` argument matches, as `(path, text)`: `~/` expanded, relative to `~/.ssh/`,
/// `*`/`?` globbed in the last component, sorted by name, each under the size limit, unreadable ones skipped.
fn resolve_include(home: &Path, ssh_dir: &Path, arg: &str) -> Vec<(String, String)> {
    let expanded = expand_arg(arg, home, ssh_dir);
    let mut matched: Vec<(String, String)> = Vec::new();
    for path in glob_last_component(&expanded) {
        if let Ok(text) = read_limited(&path) {
            matched.push((path.to_string_lossy().into_owned(), text));
        }
    }
    matched.sort_by(|a, b| a.0.cmp(&b.0));
    matched
}

fn expand_arg(arg: &str, home: &Path, ssh_dir: &Path) -> PathBuf {
    if let Some(rest) = arg.strip_prefix("~/") {
        home.join(rest)
    } else if Path::new(arg).is_absolute() {
        PathBuf::from(arg)
    } else {
        ssh_dir.join(arg)
    }
}

/// The path itself, or every file in its parent directory whose name matches the wildcard last component.
fn glob_last_component(path: &Path) -> Vec<PathBuf> {
    let last = path.file_name().and_then(|name| name.to_str());
    let has_glob = last.is_some_and(|name| name.contains('*') || name.contains('?'));
    if !has_glob {
        return vec![path.to_path_buf()];
    }
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let Some(pattern) = last else {
        return Vec::new();
    };
    let Some(entries) = std::fs::read_dir(parent).ok() else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter(|entry| entry.path().is_file())
        .filter(|entry| {
            entry
                .file_name()
                .to_str()
                .is_some_and(|name| wildcard_match(pattern, name))
        })
        .map(|entry| entry.path())
        .collect()
}

fn read_limited(path: &Path) -> io::Result<String> {
    if std::fs::metadata(path)?.len() > MAX_FILE_BYTES {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "too large"));
    }
    std::fs::read_to_string(path)
}
