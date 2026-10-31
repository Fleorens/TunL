//! Recursive upload of a local folder, as one transfer (T56).
//!
//! The tree is walked first with a stack (`tokio::fs`, never a blocking call across an `await`), so the UI
//! learns the file count and the total size (`Counted`) before the first byte. A link is never followed
//! (S11): it is counted in `skipped`, like an entry of another type. Only names checked by `valid_name` build
//! a remote path. The top folder gets a free name (like `reserve_remote`), its sub-folders are created, then
//! each file goes through its own `.part`, renamed at the end; none is ever left behind.
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Instant;

use russh_sftp::client::SftpSession;
use russh_sftp::client::error::Error as SftpError;
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;

use crate::error::{AppError, ErrorKind};
use crate::sftp::ops::{is_taken, join, map_sftp_error, reserve_remote, suffixed, valid_name};
use crate::sftp::transfer::{
    Cumulative, Outcome, TransferEvent, TransferSink, copy, emit_final, local_io_error,
};

/// One local file to upload: its path, its path under the top folder, its size.
struct LocalFile {
    local: PathBuf,
    relative: PathBuf,
    size: u64,
}

/// What the walk found under the top folder: its sub-folders (parents first), files, and skipped entries.
#[derive(Default)]
struct Walk {
    dirs: Vec<PathBuf>,
    files: Vec<LocalFile>,
    bytes: u64,
    skipped: u32,
}

/// Walk `top` with a stack: folders are entered, files kept with their size, anything else skipped.
/// A link is never followed (S11), and a name that is not UTF-8 or that `valid_name` rejects is skipped.
async fn walk_local(top: &Path, cancel: &CancellationToken) -> Result<Walk, Outcome> {
    let mut found = Walk::default();
    let mut stack: Vec<(PathBuf, PathBuf)> = vec![(top.to_path_buf(), PathBuf::new())];
    while let Some((current, relative)) = stack.pop() {
        if cancel.is_cancelled() {
            return Err(Outcome::Cancelled);
        }
        let mut entries = tokio::fs::read_dir(&current)
            .await
            .map_err(|error| Outcome::Failed(local_io_error("cannot read the folder", &error)))?;
        loop {
            let value = match entries.next_entry().await {
                Ok(entry) => entry,
                Err(error) => {
                    return Err(Outcome::Failed(local_io_error(
                        "cannot read the folder",
                        &error,
                    )));
                }
            };
            let Some(entry) = value else { break };
            let path = entry.path();
            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                log::warn!("skipping {path:?}: its name is not UTF-8");
                found.skipped += 1;
                continue;
            };
            if !valid_name(name) {
                log::warn!("skipping {path:?}: its name could escape {top:?}");
                found.skipped += 1;
                continue;
            }
            // `symlink_metadata` (lstat): a link keeps its own type, it is never entered (S11).
            let meta = tokio::fs::symlink_metadata(&path).await.map_err(|error| {
                Outcome::Failed(local_io_error("cannot read the entry", &error))
            })?;
            let file_type = meta.file_type();
            let child_relative = relative.join(name);
            if file_type.is_dir() {
                found.dirs.push(child_relative.clone());
                stack.push((path, child_relative));
            } else if file_type.is_file() {
                let size = meta.len();
                found.bytes += size;
                found.files.push(LocalFile {
                    local: path,
                    relative: child_relative,
                    size,
                });
            } else {
                // A link (never followed) or any other entry.
                found.skipped += 1;
            }
        }
    }
    Ok(found)
}

/// A free folder of `base` in `remote_dir`, created once; a name taken in the meantime (a race) moves on to
/// the next one, like `reserve_remote` — up to 100 tries, an `O_EXCL`-style collision (`Failure`) is skipped.
async fn reserve_remote_dir(
    sftp: &SftpSession,
    remote_dir: &str,
    base: &str,
    cancel: &CancellationToken,
) -> Result<String, Outcome> {
    if cancel.is_cancelled() {
        return Err(Outcome::Cancelled);
    }
    if !valid_name(base) {
        return Err(Outcome::Failed(AppError::validation(
            "remoteDir",
            "must end with a plain name",
        )));
    }
    for n in 0..100 {
        let name = if n == 0 {
            base.to_string()
        } else {
            suffixed(base, n)
        };
        let target = join(remote_dir, &name);
        match sftp.create_dir(&target).await {
            Ok(()) => return Ok(target),
            Err(error) if is_taken(&error) => continue,
            Err(error) => return Err(Outcome::Failed(map_sftp_error("mkdir", &target, &error))),
        }
    }
    Err(Outcome::Failed(AppError::new(
        ErrorKind::Sftp,
        "could not reserve a free name for the folder",
    )))
}

/// Upload one local file to `target` through a free `.part` in its remote folder, renamed at the end.
async fn copy_file(
    sftp: &SftpSession,
    file: &LocalFile,
    remote_parent: &str,
    cancel: &CancellationToken,
    sink: &dyn TransferSink,
) -> Result<(), Outcome> {
    if cancel.is_cancelled() {
        return Err(Outcome::Cancelled);
    }
    let base = file
        .relative
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    let (target, part, mut dst) = match reserve_remote(sftp, remote_parent, base).await {
        Ok(reserved) => reserved,
        Err(error) => return Err(Outcome::Failed(error)),
    };
    let mut src = match tokio::fs::File::open(&file.local).await {
        Ok(file) => file,
        Err(error) => {
            let _ = sftp.remove_file(&part).await;
            return Err(Outcome::Failed(local_io_error(
                "cannot read the local file",
                &error,
            )));
        }
    };
    match copy(
        &mut src,
        &mut dst,
        Some(file.size),
        cancel,
        sink,
        &|error| local_io_error("the transfer broke off", &error),
        &|error| {
            let error: SftpError = error.into();
            map_sftp_error("write", &part, &error)
        },
    )
    .await
    {
        Ok(()) => {
            if let Err(error) = dst.shutdown().await {
                let _ = sftp.remove_file(&part).await;
                let error = error.into();
                return Err(Outcome::Failed(map_sftp_error("shutdown", &part, &error)));
            } else if let Err(error) = sftp.rename(&part, &target).await {
                let _ = sftp.remove_file(&part).await;
                return Err(Outcome::Failed(map_sftp_error("rename", &part, &error)));
            }
            Ok(())
        }
        Err(outcome) => {
            let _ = sftp.remove_file(&part).await;
            Err(outcome)
        }
    }
}

/// The whole upload once the tree is known: the top folder, its sub-folders, then each file.
async fn upload_scanned(
    sftp: &SftpSession,
    local: &Path,
    remote_dir: &str,
    found: &Walk,
    cancel: &CancellationToken,
    sink: &dyn TransferSink,
) -> Result<String, Outcome> {
    let top = reserve_remote_dir(sftp, remote_dir, local_base_name(local), cancel).await?;
    for dir in &found.dirs {
        let path = join(&top, &dir.to_string_lossy());
        sftp.create_dir(&path)
            .await
            .map_err(|error| Outcome::Failed(map_sftp_error("mkdir", &path, &error)))?;
    }
    let start = Instant::now();
    let last = Mutex::new(None);
    let mut offset: u64 = 0;
    for file in &found.files {
        let remote_parent = match file.relative.parent() {
            Some(parent) if !parent.as_os_str().is_empty() => join(&top, &parent.to_string_lossy()),
            _ => top.clone(),
        };
        let shifted = Cumulative {
            sink,
            offset,
            total: found.bytes,
            start,
            last: &last,
        };
        copy_file(sftp, file, &remote_parent, cancel, &shifted).await?;
        offset += file.size;
    }
    Ok(top)
}

/// The base name of a local path: its last component.
fn local_base_name(local: &Path) -> &str {
    local
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("")
}

/// Upload the local folder `local` to a free folder of `remote_dir`: `Counted` once after the walk,
/// `Progress` over the whole folder, then exactly one `Done`, `Cancelled` or `Failed`.
pub async fn upload_dir(
    sftp: &SftpSession,
    local: &Path,
    remote_dir: &str,
    cancel: CancellationToken,
    sink: &dyn TransferSink,
) {
    let found = match walk_local(local, &cancel).await {
        Ok(found) => found,
        Err(outcome) => {
            emit_final(sink, outcome);
            return;
        }
    };
    sink.event(TransferEvent::Counted {
        files: u32::try_from(found.files.len()).unwrap_or(u32::MAX),
        bytes: found.bytes,
        skipped: found.skipped,
    });
    match upload_scanned(sftp, local, remote_dir, &found, &cancel, sink).await {
        Ok(top) => sink.event(TransferEvent::Done { path: top }),
        Err(outcome) => emit_final(sink, outcome),
    }
}
