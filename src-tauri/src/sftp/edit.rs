//! Edit a remote file: download it into a private folder, push a local save back in place, and watch
//! the local copy for saves (T57).
//!
//! The download and the in-place push share the transfer copy (transfer.rs); the folders are created at
//! their final mode at once (docs/06-securite.md, S9), and a push never recreates a file deleted on the
//! server (decision D17).
use std::io;
use std::os::unix::fs::DirBuilderExt;
use std::path::{Path, PathBuf};

use russh_sftp::client::SftpSession;
use russh_sftp::client::error::Error as SftpError;
use russh_sftp::protocol::OpenFlags;
use serde::Serialize;
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;
use ts_rs::TS;
use uuid::Uuid;

use crate::error::{AppError, AppResult, ErrorKind};
use crate::sftp::ops::{map_sftp_error, valid_name};
use crate::sftp::transfer::{Outcome, TransferEvent, TransferSink, copy, local_io_error};

/// What the remote file looked like when last read or written. Another value means someone else wrote it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RemoteStamp {
    pub size: u64,
    pub mtime: u32,
}

/// Why a push did not happen.
#[derive(Debug)]
pub enum PushError {
    /// The remote file changed since `expected`: nothing was written.
    Conflict,
    Failed(AppError),
}

/// What happens to one edit, sent to the UI through its `Channel` (T57).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum EditEvent {
    /// Downloaded and handed to the default application.
    Opened { local_path: String },
    /// A local save reached the server.
    Saved,
    /// The remote file changed since it was opened or last saved: waiting for `sftp_edit_resolve`.
    Conflict,
    /// A save could not be sent; the next local save tries again.
    Failed { error: AppError },
    /// The edit ended (its tab closed): the local copy is gone.
    Closed,
}

/// The base name of a remote path, so the local copy keeps it (S11: a plain name only).
fn base_name(remote: &str) -> &str {
    remote.rsplit('/').next().unwrap_or("")
}

/// Create `dir` (and its parents) at mode 0700 at once, never leaving a looser window (S9).
fn ensure_dir(dir: &Path) -> io::Result<()> {
    std::fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(dir)
}

/// The remote file's stamp (`metadata`, which follows a link like the download does).
pub async fn stamp(sftp: &SftpSession, remote: &str) -> AppResult<RemoteStamp> {
    let metadata = sftp
        .metadata(remote)
        .await
        .map_err(|error| map_sftp_error("metadata", remote, &error))?;
    Ok(RemoteStamp {
        size: metadata.size.unwrap_or(0),
        mtime: metadata.mtime.unwrap_or(0),
    })
}

/// Download `remote` to `<edit_dir>/<edit_id>/<base name>` (folders 0700, file 0600), and its stamp.
pub async fn fetch(
    sftp: &SftpSession,
    remote: &str,
    edit_dir: &Path,
    edit_id: Uuid,
) -> AppResult<(PathBuf, RemoteStamp)> {
    let base = base_name(remote);
    if !valid_name(base) {
        return Err(AppError::validation("path", "must be a plain name"));
    }
    // The private folders at their final mode (S9): the edit dir, then the edit's own folder.
    ensure_dir(edit_dir)?;
    let edit_path = edit_dir.join(edit_id.to_string());
    ensure_dir(&edit_path)?;
    let local = edit_path.join(base);

    // The remote's stamp, read once (its metadata follows a link, like the download does).
    let stamp = stamp(sftp, remote).await?;

    // The remote to read, the local file to write at 0600 and truncated to its new size.
    let mut src = sftp
        .open(remote)
        .await
        .map_err(|error| map_sftp_error("open", remote, &error))?;
    let mut dst = tokio::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(&local)
        .await
        .map_err(|error| local_io_error("cannot create the local file", &error))?;

    move_file(
        &mut src,
        &mut dst,
        Some(stamp.size),
        |error| {
            let error: SftpError = error.into();
            map_sftp_error("read", remote, &error)
        },
        |error| local_io_error("the edit broke off", &error),
    )
    .await?;

    Ok((local, stamp))
}

/// Write `local` over `remote`, **in place**, then return the new stamp. With `Some(expected)`, the
/// remote stamp is read first: another value gives `PushError::Conflict` and nothing is written. `None`
/// writes anyway.
pub async fn push(
    sftp: &SftpSession,
    local: &Path,
    remote: &str,
    expected: Option<RemoteStamp>,
) -> Result<RemoteStamp, PushError> {
    if let Some(expected) = expected {
        let current = stamp(sftp, remote).await.map_err(PushError::Failed)?;
        if current != expected {
            return Err(PushError::Conflict);
        }
    }
    // In place: open the existing file with WRITE | TRUNCATE (no CREATE). A file deleted meanwhile fails
    // to open, not recreated (decision D17).
    let mut file = sftp
        .open_with_flags(remote, OpenFlags::WRITE | OpenFlags::TRUNCATE)
        .await
        .map_err(|error| PushError::Failed(map_sftp_error("open", remote, &error)))?;
    let size = tokio::fs::metadata(local)
        .await
        .map_err(|error| PushError::Failed(local_io_error("cannot read the local file", &error)))?
        .len();
    let mut src = tokio::fs::File::open(local)
        .await
        .map_err(|error| PushError::Failed(local_io_error("cannot read the local file", &error)))?;

    move_file(
        &mut src,
        &mut file,
        Some(size),
        |error| local_io_error("cannot read the local file", &error),
        |error| {
            let error: SftpError = error.into();
            map_sftp_error("write", remote, &error)
        },
    )
    .await
    .map_err(PushError::Failed)?;

    file.shutdown().await.map_err(|error| {
        let error: SftpError = error.into();
        PushError::Failed(map_sftp_error("shutdown", remote, &error))
    })?;
    stamp(sftp, remote).await.map_err(PushError::Failed)
}

/// Remove the whole edit folder, if it exists (a missing one is nothing to clear).
pub fn clear_edits(edit_dir: &Path) -> io::Result<()> {
    match std::fs::remove_dir_all(edit_dir) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

/// A transfer sink that drops its events: an edit has no progress to show.
struct Silent;

impl TransferSink for Silent {
    fn event(&self, _event: TransferEvent) {}
}

/// Copy `src` to `dst`, mapping the `io::Error` of each side into an `AppError` (S8: no content logged).
///
/// `read_err` maps `src`, `write_err` maps `dst`; a cancelled copy is a failed save.
async fn move_file<W, R>(
    src: &mut R,
    dst: &mut W,
    total: Option<u64>,
    read_err: impl Fn(io::Error) -> AppError + Sync,
    write_err: impl Fn(io::Error) -> AppError + Sync,
) -> AppResult<()>
where
    R: tokio::io::AsyncReadExt + Unpin,
    W: tokio::io::AsyncWriteExt + Unpin,
{
    let cancel = CancellationToken::new();
    copy(src, dst, total, &cancel, &Silent, &read_err, &write_err)
        .await
        .map_err(|outcome| match outcome {
            Outcome::Cancelled => AppError::new(ErrorKind::Cancelled, "the edit was cancelled"),
            Outcome::Failed(error) => error,
        })
}
