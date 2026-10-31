//! File transfers between a remote session and the local machine (T26).
//!
//! `download` and `upload` copy a file in `CHUNK_SIZE` blocks, emit `Progress` events while moving,
//! and end with exactly one final event (`Done`, `Failed`, or `Cancelled`). The copy is private and
//! shared by both directions; the local vs. remote error mapping is passed in as a closure (S8: no
//! file content ever reaches a log).
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use russh_sftp::client::SftpSession;
use russh_sftp::client::error::Error as SftpError;
use serde::Serialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_util::sync::CancellationToken;
use ts_rs::TS;

// `suffixed` lives with the other name helpers in `ops`; re-exported here so the T26 contract test
// (transfer_tests.rs) keeps importing it from `transfer`.
pub use crate::sftp::ops::suffixed;

use crate::error::{AppError, AppResult, ErrorKind};

/// The size of one block read from, then written to, the other side.
pub const CHUNK_SIZE: usize = 64 * 1024;
/// The minimum time between two `Progress` events (plus one final event at the end).
pub const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);

/// An event about a transfer, sent to the UI through a `TransferSink`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum TransferEvent {
    Progress {
        transferred: u64,
        total: Option<u64>,
        bytes_per_sec: u64,
    },
    /// Where the file ended up: local for a download, remote for an upload.
    Done {
        path: String,
    },
    Failed {
        error: AppError,
    },
    Cancelled,
    /// What a folder transfer will copy, sent once after the scan, before the first byte (T55).
    Counted {
        files: u32,
        bytes: u64,
        skipped: u32,
    },
}

/// Something that receives a transfer's events (the UI, or a test).
pub trait TransferSink: Send + Sync {
    fn event(&self, event: TransferEvent);
}

/// The outcome of the copy: cancelled by the token, or failed with an error.
pub(crate) enum Outcome {
    Cancelled,
    Failed(AppError),
}

/// `name` when free, else the first `suffixed(name, 1, 2, …)` that is.
pub fn first_free(name: &str, taken: impl Fn(&str) -> bool) -> String {
    if !taken(name) {
        return name.to_string();
    }
    let mut n = 1;
    loop {
        let candidate = suffixed(name, n);
        if !taken(&candidate) {
            return candidate;
        }
        n += 1;
    }
}

/// The local path a remote file downloads to: an unused name in `dir` (a `.part` counts as taken).
pub fn local_target(dir: &Path, remote_name: &str) -> AppResult<PathBuf> {
    if !crate::sftp::ops::valid_name(remote_name) {
        return Err(AppError::validation("path", "must be a plain name"));
    }
    let name = first_free(remote_name, |name| {
        dir.join(name).exists() || dir.join(format!("{name}.part")).exists()
    });
    Ok(dir.join(name))
}

/// An unused local name in `dir`, and its `.part` created at once (`create_new`), so two downloads of the
/// same file started together never pick the same name: the one that loses the race sees the other's
/// `.part` and tries the next free name (lot 5 review). Returns the final path, the `.part` and its file.
pub async fn reserve_local(
    dir: &Path,
    remote_name: &str,
) -> AppResult<(PathBuf, String, tokio::fs::File)> {
    loop {
        let target = local_target(dir, remote_name)?;
        let part = format!("{}.part", target.display());
        match tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&part)
            .await
        {
            Ok(file) => return Ok((target, part, file)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(local_io_error("cannot create the local file", &error)),
        }
    }
}

/// The size of the remote file and the file opened for reading (the size follows a link, like the read).
async fn open_remote(
    sftp: &SftpSession,
    remote: &str,
) -> AppResult<(Option<u64>, russh_sftp::client::fs::File)> {
    let metadata = sftp
        .metadata(remote)
        .await
        .map_err(|error| crate::sftp::ops::map_sftp_error("metadata", remote, &error))?;
    let file = sftp
        .open(remote)
        .await
        .map_err(|error| crate::sftp::ops::map_sftp_error("open", remote, &error))?;
    Ok((metadata.size, file))
}

/// The base name of a remote path: its last segment (a trailing "/" gives "").
pub(crate) fn remote_base_name(remote: &str) -> &str {
    remote.rsplit('/').next().unwrap_or("")
}

/// The base name of a local path: its last component.
fn local_base_name(local: &Path) -> &str {
    local
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("")
}

/// A local `io::Error` into an `Io` `AppError`, logging the system error (S8: no file content).
pub(crate) fn local_io_error(message: &str, error: &io::Error) -> AppError {
    log::warn!("{message}: {error}");
    AppError::new(ErrorKind::Io, message)
}

/// One `Progress` event, `bytes_per_sec` derived from the elapsed time.
pub(crate) fn emit_progress(
    sink: &dyn TransferSink,
    transferred: u64,
    total: Option<u64>,
    elapsed: Duration,
) {
    let bytes_per_sec = if elapsed.as_secs_f64() > 0.0 {
        (transferred as f64 / elapsed.as_secs_f64()) as u64
    } else {
        0
    };
    sink.event(TransferEvent::Progress {
        transferred,
        total,
        bytes_per_sec,
    });
}

/// The single final event, emitted last, from the copy's outcome.
pub(crate) fn emit_final(sink: &dyn TransferSink, outcome: Outcome) {
    match outcome {
        Outcome::Cancelled => sink.event(TransferEvent::Cancelled),
        Outcome::Failed(error) => sink.event(TransferEvent::Failed { error }),
    }
}

/// Copy `src` to `dst` in `CHUNK_SIZE` blocks, cancelling on `cancel`.
///
/// A `Progress` is emitted at most every `PROGRESS_INTERVAL`, plus one final (transferred == total).
/// `read_err` / `write_err` map the local `io::Error` of each side into an `AppError`.
pub(crate) async fn copy<R, W>(
    src: &mut R,
    dst: &mut W,
    total: Option<u64>,
    cancel: &CancellationToken,
    sink: &dyn TransferSink,
    read_err: &(dyn Fn(io::Error) -> AppError + Sync),
    write_err: &(dyn Fn(io::Error) -> AppError + Sync),
) -> Result<(), Outcome>
where
    R: AsyncReadExt + Unpin,
    W: AsyncWriteExt + Unpin,
{
    let start = Instant::now();
    let mut buffer = vec![0u8; CHUNK_SIZE];
    let mut transferred: u64 = 0;
    let mut last = start;
    loop {
        let n = tokio::select! {
            _ = cancel.cancelled() => return Err(Outcome::Cancelled),
            result = src.read(&mut buffer) => match result {
                Ok(n) => n,
                Err(error) => return Err(Outcome::Failed(read_err(error))),
            },
        };
        if n == 0 {
            break;
        }
        if let Err(error) = dst.write_all(&buffer[..n]).await {
            return Err(Outcome::Failed(write_err(error)));
        }
        transferred += n as u64;
        let now = Instant::now();
        if now.duration_since(last) >= PROGRESS_INTERVAL {
            emit_progress(sink, transferred, total, now.duration_since(start));
            last = now;
        }
    }
    emit_progress(
        sink,
        transferred,
        total,
        Instant::now().duration_since(start),
    );
    Ok(())
}

/// Flush the local `.part` (tokio writes in the background), then rename it into place.
pub(crate) async fn finish_local(
    dst: &mut tokio::fs::File,
    part: &str,
    target: &Path,
) -> io::Result<()> {
    dst.flush().await?;
    tokio::fs::rename(part, target).await
}

/// Download `remote` to an unused file in `local_dir`, renaming the `.part` into place on success.
pub async fn download(
    sftp: &SftpSession,
    remote: &str,
    local_dir: &Path,
    cancel: CancellationToken,
    sink: &dyn TransferSink,
) {
    // The `.part` is created first: its name is reserved before the server is even asked (lot 5 review).
    let (target, part, mut dst) = match reserve_local(local_dir, remote_base_name(remote)).await {
        Ok(reserved) => reserved,
        Err(error) => {
            emit_final(sink, Outcome::Failed(error));
            return;
        }
    };
    let (size, mut src) = match open_remote(sftp, remote).await {
        Ok(opened) => opened,
        Err(error) => {
            let _ = tokio::fs::remove_file(&part).await;
            emit_final(sink, Outcome::Failed(error));
            return;
        }
    };
    match copy(
        &mut src,
        &mut dst,
        size,
        &cancel,
        sink,
        &|error| {
            let error: SftpError = error.into();
            crate::sftp::ops::map_sftp_error("read", remote, &error)
        },
        &|error| local_io_error("the transfer broke off", &error),
    )
    .await
    {
        Ok(()) => match finish_local(&mut dst, &part, &target).await {
            Ok(()) => sink.event(TransferEvent::Done {
                path: target.to_string_lossy().into_owned(),
            }),
            Err(error) => {
                let _ = tokio::fs::remove_file(&part).await;
                emit_final(
                    sink,
                    Outcome::Failed(local_io_error("cannot create the local file", &error)),
                );
            }
        },
        Err(outcome) => {
            let _ = tokio::fs::remove_file(&part).await;
            emit_final(sink, outcome);
        }
    }
}

/// Upload `local` to an unused name in `remote_dir`, renaming the `.part` into place on success.
///
/// A local directory is refused before anything reaches the server; the `.part` is reserved with
/// `O_EXCL` so two uploads of the same name never share a file (docs/01 review).
pub async fn upload(
    sftp: &SftpSession,
    local: &Path,
    remote_dir: &str,
    cancel: CancellationToken,
    sink: &dyn TransferSink,
) {
    let base = local_base_name(local);
    if !crate::sftp::ops::valid_name(base) {
        emit_final(
            sink,
            Outcome::Failed(AppError::validation("localPath", "must be a plain name")),
        );
        return;
    }
    // A local directory is refused before any action on the server (docs/01 review). The metadata gives
    // the size too, so it is read once.
    let size = match tokio::fs::metadata(local).await {
        Ok(metadata) if !metadata.is_dir() => Some(metadata.len()),
        Ok(_) => {
            emit_final(
                sink,
                Outcome::Failed(AppError::validation("localPath", "is a directory")),
            );
            return;
        }
        Err(error) => {
            emit_final(
                sink,
                Outcome::Failed(local_io_error("cannot read the local file", &error)),
            );
            return;
        }
    };
    let (target, part, mut dst) =
        match crate::sftp::ops::reserve_remote(sftp, remote_dir, base).await {
            Ok(reserved) => reserved,
            Err(error) => {
                emit_final(sink, Outcome::Failed(error));
                return;
            }
        };
    let mut src = match tokio::fs::File::open(local).await {
        Ok(file) => file,
        Err(error) => {
            let _ = sftp.remove_file(&part).await;
            emit_final(
                sink,
                Outcome::Failed(local_io_error("cannot read the local file", &error)),
            );
            return;
        }
    };
    match copy(
        &mut src,
        &mut dst,
        size,
        &cancel,
        sink,
        &|error| local_io_error("the transfer broke off", &error),
        &|error| {
            let error: SftpError = error.into();
            crate::sftp::ops::map_sftp_error("write", &part, &error)
        },
    )
    .await
    {
        Ok(()) => {
            if let Err(error) = dst.shutdown().await {
                let error = crate::sftp::ops::map_sftp_error("shutdown", &part, &error.into());
                let _ = sftp.remove_file(&part).await;
                emit_final(sink, Outcome::Failed(error));
            } else if let Err(error) = sftp.rename(&part, &target).await {
                let error = crate::sftp::ops::map_sftp_error("rename", &part, &error);
                let _ = sftp.remove_file(&part).await;
                emit_final(sink, Outcome::Failed(error));
            } else {
                sink.event(TransferEvent::Done { path: target });
            }
        }
        Err(outcome) => {
            let _ = sftp.remove_file(&part).await;
            emit_final(sink, outcome);
        }
    }
}
