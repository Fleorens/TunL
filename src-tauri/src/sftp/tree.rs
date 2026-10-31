//! Recursive download of a remote folder, as one transfer (T55).
//!
//! The tree is walked first with a stack (never a recursion across an `await`, like `ops::count`), so the
//! UI learns the file count and the total size (`Counted`) before the first byte. A link is never followed
//! (S11): it is counted in `skipped`, like an entry of another type. Only names checked by `valid_name` build
//! a local path. Each file goes through its own `.part`, renamed at the end; none is ever left behind.
//!
//! The upload (T56) shares the walk, the cumulative `Progress` and the `.part` rule; it lives in `tree_upload`
//! and is re-exported here so `sftp::tree::upload_dir` is the public path of both.
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Instant;

use russh_sftp::client::SftpSession;
use russh_sftp::client::error::Error as SftpError;
use russh_sftp::protocol::FileType;
use tokio_util::sync::CancellationToken;

use crate::error::AppError;
use crate::sftp::ops::{entry_metadata, map_sftp_error, valid_name};
use crate::sftp::transfer::{
    Cumulative, Outcome, TransferEvent, TransferSink, copy, emit_final, finish_local, first_free,
    local_io_error, remote_base_name,
};

// The upload (T56) lives in `tree_upload`; re-export it so `sftp::tree::upload_dir` is the public path of
// both the download and the upload, as the tests and the command import it there.
pub use super::tree_upload::upload_dir;

/// One remote file to copy: its remote path, its path under the local top folder, its size.
struct RemoteFile {
    remote: String,
    relative: PathBuf,
    size: u64,
}

/// What the walk found under the remote folder: its sub-folders (parents first), files, and skipped entries.
#[derive(Default)]
struct Scan {
    dirs: Vec<PathBuf>,
    files: Vec<RemoteFile>,
    bytes: u64,
    skipped: u32,
}

/// Walk `remote` with a stack: folders are entered, files kept with their size, anything else skipped.
async fn scan(
    sftp: &SftpSession,
    remote: &str,
    cancel: &CancellationToken,
) -> Result<Scan, Outcome> {
    let mut found = Scan::default();
    let mut stack: Vec<(String, PathBuf)> = vec![(remote.to_string(), PathBuf::new())];
    while let Some((current, relative)) = stack.pop() {
        if cancel.is_cancelled() {
            return Err(Outcome::Cancelled);
        }
        let entries = sftp
            .read_dir(&current)
            .await
            .map_err(|error| Outcome::Failed(map_sftp_error("download", &current, &error)))?;
        for entry in entries {
            let name = entry.file_name();
            if !valid_name(&name) {
                // The name could escape the folder: skip it, naming the folder, not the name.
                log::warn!("skipping an entry whose name could escape {current}");
                continue;
            }
            let child = entry.path();
            let meta = entry_metadata(sftp, &entry, &child, "download")
                .await
                .map_err(Outcome::Failed)?;
            let child_relative = relative.join(&name);
            match meta.file_type() {
                FileType::Dir => {
                    found.dirs.push(child_relative.clone());
                    stack.push((child, child_relative));
                }
                FileType::File => {
                    let size = meta.size.unwrap_or(0);
                    found.bytes += size;
                    found.files.push(RemoteFile {
                        remote: child,
                        relative: child_relative,
                        size,
                    });
                }
                FileType::Symlink | FileType::Other => {
                    found.skipped = found.skipped.saturating_add(1);
                }
            }
        }
    }
    Ok(found)
}

/// The local top folder: a free name in `local_dir`, created with `create_dir`; a name taken in the
/// meantime (a race) moves on to the next one, like `reserve_local`.
async fn create_top(local_dir: &Path, remote: &str) -> Result<PathBuf, Outcome> {
    // A trailing "/" (`/home/me/photos/`) still names the folder.
    let base = remote_base_name(remote.trim_end_matches('/'));
    if !valid_name(base) {
        return Err(Outcome::Failed(AppError::validation(
            "remotePath",
            "must end with a plain name",
        )));
    }
    loop {
        let top = local_dir.join(first_free(base, |name| local_dir.join(name).exists()));
        match tokio::fs::create_dir(&top).await {
            Ok(()) => return Ok(top),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(Outcome::Failed(local_io_error(
                    "cannot create the local folder",
                    &error,
                )));
            }
        }
    }
}

/// A free `.part` next to `target`, created with `create_new`: `<name>.part`, or `<name> (1).part`… when the
/// folder already holds a file of that name (a remote `x.part` copied before `x`).
async fn reserve_part(target: &Path) -> Result<(PathBuf, tokio::fs::File), Outcome> {
    let name = target
        .file_name()
        .map(|name| format!("{}.part", name.to_string_lossy()))
        .unwrap_or_default();
    loop {
        let part = target.with_file_name(first_free(&name, |candidate| {
            target.with_file_name(candidate).exists()
        }));
        match tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&part)
            .await
        {
            Ok(file) => return Ok((part, file)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(Outcome::Failed(local_io_error(
                    "cannot create the local file",
                    &error,
                )));
            }
        }
    }
}

/// Copy one remote file to `target` through a free `.part`; the `.part` is removed on any failure.
async fn copy_file(
    sftp: &SftpSession,
    file: &RemoteFile,
    target: &Path,
    cancel: &CancellationToken,
    sink: &dyn TransferSink,
) -> Result<(), Outcome> {
    if cancel.is_cancelled() {
        return Err(Outcome::Cancelled);
    }
    let mut src = sftp
        .open(&file.remote)
        .await
        .map_err(|error| Outcome::Failed(map_sftp_error("open", &file.remote, &error)))?;
    let (part, mut dst) = reserve_part(target).await?;
    let copied = copy(
        &mut src,
        &mut dst,
        Some(file.size),
        cancel,
        sink,
        &|error| {
            let error: SftpError = error.into();
            map_sftp_error("read", &file.remote, &error)
        },
        &|error| local_io_error("the transfer broke off", &error),
    )
    .await;
    let result = match copied {
        Ok(()) => finish_local(&mut dst, &part, target)
            .await
            .map_err(|error| {
                Outcome::Failed(local_io_error("cannot create the local file", &error))
            }),
        Err(outcome) => Err(outcome),
    };
    if result.is_err() {
        let _ = tokio::fs::remove_file(&part).await;
    }
    result
}

/// The whole download once the tree is known: the top folder, its sub-folders, then each file.
async fn download_scanned(
    sftp: &SftpSession,
    remote: &str,
    local_dir: &Path,
    found: &Scan,
    cancel: &CancellationToken,
    sink: &dyn TransferSink,
) -> Result<PathBuf, Outcome> {
    let top = create_top(local_dir, remote).await?;
    for dir in &found.dirs {
        tokio::fs::create_dir(top.join(dir))
            .await
            .map_err(|error| {
                Outcome::Failed(local_io_error("cannot create the local folder", &error))
            })?;
    }
    let start = Instant::now();
    let last = Mutex::new(None);
    let mut offset: u64 = 0;
    for file in &found.files {
        let shifted = Cumulative {
            sink,
            offset,
            total: found.bytes,
            start,
            last: &last,
        };
        copy_file(sftp, file, &top.join(&file.relative), cancel, &shifted).await?;
        offset += file.size;
    }
    Ok(top)
}

/// Download the remote folder `remote` into a free folder of `local_dir`: `Counted` once after the walk,
/// `Progress` over the whole folder, then exactly one `Done`, `Cancelled` or `Failed`.
pub async fn download_dir(
    sftp: &SftpSession,
    remote: &str,
    local_dir: &Path,
    cancel: CancellationToken,
    sink: &dyn TransferSink,
) {
    let found = match scan(sftp, remote, &cancel).await {
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
    match download_scanned(sftp, remote, local_dir, &found, &cancel, sink).await {
        Ok(top) => sink.event(TransferEvent::Done {
            path: top.to_string_lossy().into_owned(),
        }),
        Err(outcome) => emit_final(sink, outcome),
    }
}
