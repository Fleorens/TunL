use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::{AppError, AppResult};

/// Appends `suffix` to `path` (e.g. `connections.json` → `connections.json.tmp`).
///
/// The suffix is pushed onto the OS string rather than going through `display()`,
/// which would be lossy on non-UTF-8 paths (docs/01-architecture.md §9).
fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(suffix);
    PathBuf::from(name)
}

/// Removes `path` if it exists, without swallowing errors other than "not found".
fn remove_if_exists(path: &Path) -> AppResult<()> {
    match fs::remove_file(path) {
        Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error.into()),
        _ => Ok(()),
    }
}

/// Reads a store file to a string. IO errors propagate; the caller decides how to treat
/// a JSON parse error (quarantine for the store, error for migrations).
pub fn read(path: &Path) -> AppResult<String> {
    Ok(fs::read_to_string(path)?)
}

/// Moves `path` to `<path>.corrupt-<now_ms>`, keeping its content and permissions.
pub fn quarantine(path: &Path, now_ms: i64) -> AppResult<PathBuf> {
    let dest = with_suffix(path, &format!(".corrupt-{now_ms}"));
    fs::rename(path, &dest)?;
    Ok(dest)
}

/// Writes `value` as pretty JSON to `path`, atomically, keeping a `.bak` and 0600 permissions.
///
/// The order is fixed so the main file exists at every instant (docs/01-architecture.md §9):
/// 1. start from a clean `.tmp` (mode 0600),
/// 2. write the JSON, then `sync_all`,
/// 3. snapshot the current main as `.bak` through a hard link,
/// 4. atomically rename the `.tmp` over the main,
/// 5. `sync_all` the directory so the rename survives a power cut.
pub fn write_json_atomic(path: &Path, value: &impl Serialize) -> AppResult<()> {
    let Some(dir) = path.parent() else {
        return Err(AppError::internal("the store file has no parent directory"));
    };

    let tmp = with_suffix(path, ".tmp");
    let bak = with_suffix(path, ".bak");

    // `create_new` (not `truncate`) so the mode below always applies: an existing `.tmp`
    // left by a crash would keep its old permissions otherwise (docs/06-securite.md, S9).
    remove_if_exists(&tmp)?;
    let mut tmp_file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&tmp)?;
    let mut bytes = serde_json::to_vec_pretty(value)?;
    bytes.push(b'\n');
    tmp_file.write_all(&bytes)?;
    tmp_file.sync_all()?;

    // Keep the previous content as a `.bak` without copying it: the hard link shares the inode.
    if path.exists() {
        remove_if_exists(&bak)?;
        fs::hard_link(path, &bak)?;
    }

    fs::rename(&tmp, path)?;

    // Syncing the directory makes the rename durable across a power loss.
    let dir_file = File::open(dir)?;
    dir_file.sync_all()?;
    Ok(())
}
