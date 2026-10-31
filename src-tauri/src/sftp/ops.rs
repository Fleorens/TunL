//! The SFTP operations the explorer and the transfers run on a session (T24).
//!
//! The pure helpers (name, path, join, entry, error) are tested without a server. The operations run
//! on a `russh_sftp` session; `count` and `remove` walk the tree with a stack, never recursing across
//! an `await` (docs/06 S11, S7). The root is examined with `symlink_metadata`; its children take their
//! type from the `read_dir` attributes, falling back to `symlink_metadata` only when the server reports
//! none (docs/01 review), so counting a large directory is no longer a `stat` per entry.
use russh_sftp::client::SftpSession;
use russh_sftp::client::error::Error as SftpError;
use russh_sftp::client::fs::DirEntry;
use russh_sftp::client::fs::File;
use russh_sftp::client::fs::Metadata;
use russh_sftp::protocol::FileType;
use russh_sftp::protocol::OpenFlags;
use russh_sftp::protocol::StatusCode;

use super::{EntryKind, RemoteEntry};
use crate::error::{AppError, AppResult, ErrorKind};

/// A remote path is absolute (starts with "/") and carries no NUL, so it cannot point outside the
/// tree (S11). `field` is the camelCase field name, so the UI can attach the message to it.
pub fn validate_remote_path(field: &str, path: &str) -> AppResult<()> {
    if path.starts_with('/') && !path.contains('\0') {
        Ok(())
    } else {
        Err(AppError::validation(
            field,
            "must be absolute and without a NUL",
        ))
    }
}

/// A name that could escape its directory is invalid: empty, ".", "..", a "/", or a NUL (S11).
pub fn valid_name(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".." && !name.contains('/') && !name.contains('\0')
}

/// `dir` + "/" + `name`, without doubling the slash of the root ("/" + "etc" is "/etc").
pub fn join(dir: &str, name: &str) -> String {
    if dir == "/" {
        format!("/{name}")
    } else if dir.ends_with('/') {
        format!("{dir}{name}")
    } else {
        format!("{dir}/{name}")
    }
}

/// `(n)` before the extension: `report (1).pdf`, `archive.tar (2).gz`, `notes (3)`, `.bashrc (1)`.
///
/// A leading "." is a hidden-file marker, not an extension separator.
pub fn suffixed(name: &str, n: u32) -> String {
    let (stem, ext) = if let Some(rest) = name.strip_prefix('.') {
        match rest.rfind('.') {
            Some(i) => (&name[..i + 1], &name[i + 2..]),
            None => (name, ""),
        }
    } else {
        match name.rfind('.') {
            Some(i) => (&name[..i], &name[i + 1..]),
            None => (name, ""),
        }
    };
    if ext.is_empty() {
        format!("{name} ({n})")
    } else {
        format!("{stem} ({n}).{ext}")
    }
}

/// One remote entry from its directory, its name and the attributes `read_dir` returned for it (an
/// entry keeps its own type, even a link; docs/05 §8).
fn kind_from_file_type(file_type: FileType) -> EntryKind {
    match file_type {
        FileType::Dir => EntryKind::Dir,
        FileType::Symlink => EntryKind::Symlink,
        FileType::File => EntryKind::File,
        FileType::Other => EntryKind::Other,
    }
}

pub fn entry_from(dir: &str, name: &str, attrs: &Metadata) -> RemoteEntry {
    RemoteEntry {
        name: name.to_string(),
        path: join(dir, name),
        kind: kind_from_file_type(attrs.file_type()),
        size: attrs.size.unwrap_or(0),
        modified_at: attrs.mtime.map(|secs| i64::from(secs) * 1000),
        permissions: attrs.permissions.map(|mode| mode & 0o7777),
        hidden: name.starts_with('.'),
        // `list` fills this in, following the link, only for symlinks (T48).
        target_kind: None,
    }
}

/// Turn an SFTP error into an `AppError`, without the server's own text (S7). `op` and `path` name
/// the failed operation and the path it ran on.
pub fn map_sftp_error(op: &str, path: &str, error: &SftpError) -> AppError {
    match error {
        SftpError::Status(status) => match status.status_code {
            StatusCode::NoSuchFile => AppError::not_found(path),
            StatusCode::PermissionDenied => {
                AppError::new(ErrorKind::Sftp, format!("{op}: permission denied: {path}"))
            }
            _ => AppError::new(ErrorKind::Sftp, format!("{op} failed: {path}")),
        },
        SftpError::Timeout => AppError::new(ErrorKind::Timeout, "the server stopped answering"),
        SftpError::IO(_) => AppError::new(ErrorKind::Network, "connection closed"),
        _ => AppError::new(ErrorKind::Sftp, format!("{op} failed: {path}")),
    }
}

/// The remote path of a file, canonicalized (".", a relative path, or ".." are resolved; docs/05 §8).
pub async fn realpath(sftp: &SftpSession, path: &str) -> AppResult<String> {
    sftp.canonicalize(path)
        .await
        .map_err(|error| map_sftp_error("realpath", path, &error))
}

/// A directory's entries, invalid names skipped (a name could escape it, S11), sorted by name.
pub async fn list(sftp: &SftpSession, dir: &str) -> AppResult<Vec<RemoteEntry>> {
    let mut entries: Vec<RemoteEntry> = sftp
        .read_dir(dir)
        .await
        .map_err(|error| map_sftp_error("list", dir, &error))?
        .filter_map(|entry| {
            let name = entry.file_name();
            if valid_name(&name) {
                Some(entry_from(dir, &name, &entry.metadata()))
            } else {
                // The name could escape the directory: skip it, naming the directory, not the name.
                log::warn!("skipping an entry whose name could escape {dir}");
                None
            }
        })
        .collect();

    // A link's own type is `symlink`; to know whether it is a file or a folder, ask the server what
    // it points to (T48). One `metadata` call per link, none for any other entry, and an error here
    // says nothing about the link — it never fails the whole list.
    for entry in entries.iter_mut() {
        if entry.kind != EntryKind::Symlink {
            continue;
        }
        match sftp.metadata(&entry.path).await {
            Ok(target) => entry.target_kind = Some(kind_from_file_type(target.file_type())),
            Err(error) => log::warn!(
                "could not read the target of {}/{}: {}",
                dir,
                entry.name,
                error
            ),
        }
    }

    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

/// Create a directory.
pub async fn mkdir(sftp: &SftpSession, path: &str) -> AppResult<()> {
    sftp.create_dir(path)
        .await
        .map_err(|error| map_sftp_error("mkdir", path, &error))
}

/// Rename `from` to `to`. The error names both paths (never the server's text, S7).
pub async fn rename(sftp: &SftpSession, from: &str, to: &str) -> AppResult<()> {
    sftp.rename(from, to)
        .await
        .map_err(|error| map_sftp_error("rename", from, &error))
}

/// Change a path's permission bits (`mode & 0o7777`). A mode above `0o7777` is rejected before any
/// call (S11).
pub async fn chmod(sftp: &SftpSession, path: &str, mode: u32) -> AppResult<()> {
    if mode > 0o7777 {
        return Err(AppError::validation("mode", "out of range"));
    }
    sftp.set_metadata(
        path,
        Metadata {
            permissions: Some(mode),
            ..Metadata::empty()
        },
    )
    .await
    .map_err(|error| map_sftp_error("chmod", path, &error))
}

/// How many entries a removal of `path` would clear, `path` included: one for a file or a link, one
/// for a directory plus its contents (a link counts as one, never entered; S11).
pub async fn count(sftp: &SftpSession, path: &str) -> AppResult<u64> {
    let mut total: u64 = 0;
    // The root is examined with symlink_metadata; its children carry their type from read_dir (docs/01 review).
    let mut stack: Vec<(String, bool)> = vec![(path.to_string(), is_dir(sftp, path).await?)];
    while let Some((current, is_dir)) = stack.pop() {
        total += 1;
        // Descend only into real directories (lstat): a link to a directory is one entry, never entered.
        if is_dir {
            for entry in sftp
                .read_dir(&current)
                .await
                .map_err(|error| map_sftp_error("count", &current, &error))?
            {
                let name = entry.file_name();
                if valid_name(&name) {
                    let child = entry.path();
                    let is_child = entry_is_dir(sftp, &entry, &child, "count").await?;
                    stack.push((child, is_child));
                }
            }
        }
    }
    Ok(total)
}

/// Remove `path`: a file or a link is removed as one (lstat, never its target); a directory has its
/// contents removed first, in depth, then the directory itself (S11). The root cannot be removed.
pub async fn remove(sftp: &SftpSession, path: &str) -> AppResult<()> {
    if resolves_to_root(path) {
        return Err(AppError::validation("path", "cannot remove the root"));
    }
    // Post-order removal with a stack: the root is examined with symlink_metadata, its children carry their
    // type from read_dir (docs/01 review). A directory is removed only after its children, a file or a link
    // (lstat) as one, never entered.
    let mut stack: Vec<(String, bool, bool)> =
        vec![(path.to_string(), false, is_dir(sftp, path).await?)];
    while let Some((current, expanded, is_dir)) = stack.pop() {
        if expanded {
            sftp.remove_dir(&current)
                .await
                .map_err(|error| map_sftp_error("remove", &current, &error))?;
            continue;
        }
        if is_dir {
            // Re-pushed only for directories, after their children are gone.
            stack.push((current.clone(), true, false));
            for entry in sftp
                .read_dir(&current)
                .await
                .map_err(|error| map_sftp_error("remove", &current, &error))?
            {
                let name = entry.file_name();
                if valid_name(&name) {
                    let child = entry.path();
                    let is_child = entry_is_dir(sftp, &entry, &child, "remove").await?;
                    stack.push((child, false, is_child));
                }
            }
        } else {
            sftp.remove_file(&current)
                .await
                .map_err(|error| map_sftp_error("remove", &current, &error))?;
        }
    }
    Ok(())
}

/// A `read_dir` entry's attributes: its own when the server reports them (so no extra `stat`, docs/01
/// review), otherwise symlink_metadata as a fallback (a link keeps its own type).
pub async fn entry_metadata(
    sftp: &SftpSession,
    entry: &DirEntry,
    path: &str,
    op: &str,
) -> AppResult<Metadata> {
    let own = entry.metadata();
    if own.permissions.is_some() {
        return Ok(own);
    }
    sftp.symlink_metadata(path)
        .await
        .map_err(|error| map_sftp_error(op, path, &error))
}

/// Whether a `read_dir` entry is a directory, from `entry_metadata`.
async fn entry_is_dir(
    sftp: &SftpSession,
    entry: &DirEntry,
    path: &str,
    op: &str,
) -> AppResult<bool> {
    Ok(entry_metadata(sftp, entry, path, op)
        .await?
        .file_type()
        .is_dir())
}

/// Whether `path` is a directory (lstat: a link to a directory is not one).
pub async fn is_dir(sftp: &SftpSession, path: &str) -> AppResult<bool> {
    let meta = sftp
        .symlink_metadata(path)
        .await
        .map_err(|error| map_sftp_error("count", path, &error))?;
    Ok(meta.file_type().is_dir())
}

/// Whether `path` names the root once its empty, `.` and `..` segments are resolved (`//`, `/.`,
/// `/x/..`), so `remove` never clears it.
fn resolves_to_root(path: &str) -> bool {
    let mut depth: usize = 0;
    for segment in path.split('/') {
        match segment {
            "" | "." => {}
            ".." => depth = depth.saturating_sub(1),
            _ => depth += 1,
        }
    }
    depth == 0
}

/// The `.part` reserved on the server for an upload of `base` in `remote_dir`: an unused name opened with
/// `CREATE | EXCLUDE | WRITE` (never `TRUNCATE`), so two uploads of the same name never share a file (docs/01
/// review). A name already listed is skipped; an `O_EXCL` collision (OpenSSH: `SSH_FX_FAILURE`, `FILE_ALREADY_EXISTS`
/// is a v4 code) is skipped too, up to 100 tries; any other error stops the upload. Returns the final path, the
/// `.part`, and its file.
pub async fn reserve_remote(
    sftp: &SftpSession,
    remote_dir: &str,
    base: &str,
) -> AppResult<(String, String, File)> {
    let entries = list(sftp, remote_dir).await?;
    let taken = |name: &str| -> bool {
        entries
            .iter()
            .any(|entry| entry.name == name || entry.name == format!("{name}.part"))
    };
    for n in 0..100 {
        let name = if n == 0 {
            base.to_string()
        } else {
            suffixed(base, n)
        };
        if taken(&name) {
            continue;
        }
        let target = join(remote_dir, &name);
        let part = format!("{target}.part");
        match sftp
            .open_with_flags(
                &part,
                OpenFlags::CREATE | OpenFlags::EXCLUDE | OpenFlags::WRITE,
            )
            .await
        {
            Ok(file) => return Ok((target, part, file)),
            Err(error) if is_taken(&error) => continue,
            Err(error) => return Err(map_sftp_error("create", &part, &error)),
        }
    }
    Err(AppError::new(
        ErrorKind::Sftp,
        "could not reserve a free name for the upload",
    ))
}

/// An `O_EXCL` collision: OpenSSH reports it as `SSH_FX_FAILURE` (`FILE_ALREADY_EXISTS` is a v4 code), so the
/// name is taken and the caller moves on. Anything else stops the upload (docs/01 review).
fn is_taken(error: &SftpError) -> bool {
    matches!(
        error,
        SftpError::Status(status) if status.status_code == StatusCode::Failure
    )
}
