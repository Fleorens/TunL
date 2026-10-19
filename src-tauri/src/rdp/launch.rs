//! Launch the FreeRDP client, and follow its output until it ends (docs/01 §8, this sheet).
//!
//! FreeRDP takes one argument, `/args-from:stdin`, and reads the rest (the password included) on its
//! stdin, one argument per line, until stdin closes (docs/06, S4, S5). `launch` writes those lines, then
//! drops stdin so the stream closes. `watch` relays stdout and stderr, filtered (no secret, S8), as
//! `Log` events, and reports why the client ended.
use std::path::Path;

use std::process::Stdio;

use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStderr, ChildStdout, Command};
use tokio_util::sync::CancellationToken;

use crate::error::{AppError, AppResult, ErrorKind};
use crate::rdp::args::RdpArgs;
use crate::rdp::detect::spawn_retrying;
use crate::sessions::{CloseReason, SessionEvent, SessionSink};

/// The longest a log line may reach before it is shown (S8).
pub const MAX_LOG_LINE: usize = 300;

/// A line of FreeRDP as it may be shown (S8): trimmed, not empty, without a credential, cut short.
pub fn filter_log_line(line: &str) -> Option<String> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }
    // A line that may carry a secret is dropped (S4, S8): match on the lowercased form.
    let lower = line.to_lowercase();
    if ["password", "passwd", "/p:", "credential", "secret"]
        .iter()
        .any(|needle| lower.contains(needle))
    {
        return None;
    }
    // Cut to `MAX_LOG_LINE` characters, not bytes, so a wide line is not split mid-character.
    Some(line.chars().take(MAX_LOG_LINE).collect())
}

/// Launch `client` with `/args-from:stdin`, writing the arguments on its stdin, then closing it.
///
/// stdin, stdout and stderr are piped; `kill_on_drop` ends the client when the watcher is dropped.
/// A spawn failure is an `rdp` error (the system message is logged, not returned, S7).
pub async fn launch(client: &Path, args: &RdpArgs) -> AppResult<Child> {
    let mut command = Command::new(client);
    command
        .arg("/args-from:stdin")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = spawn_retrying(&mut command).await.map_err(|error| {
        log::warn!("cannot start the RDP client: {error}");
        AppError::new(ErrorKind::Rdp, "cannot start the RDP client")
    })?;

    // Write every argument, then drop stdin: closing the write end is what tells FreeRDP to start.
    let text = args.stdin_text();
    if let Some(mut stdin) = child.stdin.take()
        && let Err(error) = stdin.write_all(text.as_bytes()).await
    {
        log::warn!("cannot write the RDP arguments: {error}");
        return Err(AppError::new(
            ErrorKind::Rdp,
            "cannot write the RDP arguments",
        ));
    }

    Ok(child)
}

/// Relay stdout and stderr, each line filtered, until both close (the client has ended).
async fn read_both(
    stdout: Option<ChildStdout>,
    stderr: Option<ChildStderr>,
    sink: &dyn SessionSink,
) {
    tokio::join!(read_stream(stdout, sink), read_stream(stderr, sink));
}

/// Read `reader` to its end, sending each filtered line as a `Log` (S8). A read error ends the stream.
async fn read_stream<R>(reader: Option<R>, sink: &dyn SessionSink)
where
    R: AsyncRead + Unpin,
{
    let Some(reader) = reader else {
        return;
    };
    let mut reader = BufReader::new(reader);
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) | Err(_) => break,
            Ok(_) => {
                if let Some(text) = filter_log_line(&line) {
                    sink.event(SessionEvent::Log { line: text });
                }
            }
        }
    }
}

/// Follow the client until it ends, and report why.
///
/// stdout and stderr are read, then the exit code reaped, in one future raced against `cancel`: a client
/// that closes its streams without exiting can still be killed by closing the tab. That future borrows
/// `child`, so it is finished inside the block (which yields `None` on cancel) before `start_kill`.
pub async fn watch(
    mut child: Child,
    cancel: CancellationToken,
    sink: &dyn SessionSink,
) -> (CloseReason, Option<i32>) {
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let finished = {
        let run = async {
            read_both(stdout, stderr, sink).await;
            child.wait().await
        };
        tokio::select! {
            biased;
            result = run => Some(result),
            _ = cancel.cancelled() => None,
        }
    };

    match finished {
        Some(Ok(status)) => (CloseReason::ProcessExited, status.code()),
        Some(Err(error)) => {
            log::warn!("cannot read the RDP client to the end: {error}");
            (CloseReason::Error, None)
        }
        None => {
            let _ = child.start_kill();
            let _ = child.wait().await;
            (CloseReason::UserClosed, None)
        }
    }
}
