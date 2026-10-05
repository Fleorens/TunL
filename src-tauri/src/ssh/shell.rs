//! Launch a shell on an SSH connection and run it: bytes in, bytes out, sized and cancelled (T19).
//!
//! `open_shell` opens a session channel and asks for a PTY and a shell. `pump` runs the channel: it
//! forwards the shell's bytes to the sink in bounded chunks (S10), applies the UI's writes, and ends
//! cleanly when the tab closes, the remote closes, or the process exits.
use tokio::sync::mpsc;

use russh::client::{Handle, Msg};
use russh::{Channel, ChannelMsg};
use tokio_util::sync::CancellationToken;

use crate::error::{AppError, AppResult};
use crate::sessions::{CloseReason, SessionSink, ShellInput};
use crate::ssh::error::map_russh_error;
use crate::ssh::handler::ClientHandler;

/// The largest chunk of shell output sent to the UI at once, so a huge output cannot freeze it (S10).
pub const OUTPUT_CHUNK: usize = 64 * 1024;
/// The terminal type requested on the PTY.
pub const TERM: &str = "xterm-256color";

/// A terminal is at least one column/row and fits on a screen.
pub fn validate_size(cols: u32, rows: u32) -> AppResult<()> {
    if !(1..=1000).contains(&cols) {
        return Err(AppError::validation("cols", "out of range"));
    }
    if !(1..=500).contains(&rows) {
        return Err(AppError::validation("rows", "out of range"));
    }
    Ok(())
}

/// Open a session channel and ask for a PTY, then a shell (docs/01-architecture.md §5).
pub async fn open_shell(
    handle: &Handle<ClientHandler>,
    cols: u32,
    rows: u32,
) -> AppResult<Channel<Msg>> {
    let channel = handle
        .channel_open_session()
        .await
        .map_err(|error| map_russh_error(&error))?;
    channel
        .request_pty(true, TERM, cols, rows, 0, 0, &[])
        .await
        .map_err(|error| map_russh_error(&error))?;
    channel
        .request_shell(true)
        .await
        .map_err(|error| map_russh_error(&error))?;
    Ok(channel)
}

/// Run one shell until it ends. The shell's bytes go to `sink` in bounded chunks; the UI's writes and
/// the cancel token drive the rest. Returns why it ended and the process's exit status, if any.
pub async fn pump(
    channel: Channel<Msg>,
    mut input: mpsc::UnboundedReceiver<ShellInput>,
    cancel: CancellationToken,
    sink: &dyn SessionSink,
) -> (CloseReason, Option<i32>) {
    let (mut read, write) = channel.split();
    let mut exit_status: Option<i32> = None;
    loop {
        tokio::select! {
            _ = cancel.cancelled() => {
                // A closed tab ends the channel and reports it as the user's own close.
                let _ = write.close().await;
                return (CloseReason::UserClosed, None);
            }
            message = read.wait() => {
                match message {
                    // The shell's output, whether on stdout or stderr (S8: never logged).
                    Some(ChannelMsg::Data { data }) => emit_output(sink, data.to_vec()),
                    Some(ChannelMsg::ExtendedData { data, .. }) => emit_output(sink, data.to_vec()),
                    // The process exited: remember its status. The remote may still report it after
                    // EOF, so keep reading until the channel actually closes.
                    Some(ChannelMsg::ExitStatus { exit_status: code }) => {
                        exit_status = Some(code as i32);
                    }
                    // Remote close, or a fully closed channel: the shell is gone. EOF is not enough
                    // on its own — it only means the remote sent no more output, and its exit
                    // status may still follow — so the shell is gone only once the channel closes.
                    Some(ChannelMsg::Close) | None => {
                        return (CloseReason::RemoteClosed, exit_status);
                    }
                    // EOF and anything else: keep reading until the channel closes.
                    _ => {}
                }
            }
            input = input.recv() => {
                match input {
                    Some(ShellInput::Data(bytes)) => {
                        if write.data_bytes(bytes).await.is_err() {
                            return (CloseReason::Error, None);
                        }
                    }
                    Some(ShellInput::Resize { cols, rows }) => {
                        let _ = write.window_change(cols, rows, 0, 0).await;
                    }
                    // The task dropped its receiver: end like a cancel.
                    None => {
                        let _ = write.close().await;
                        return (CloseReason::UserClosed, None);
                    }
                }
            }
        }
    }
}

/// Send the shell's bytes to the UI in chunks of at most `OUTPUT_CHUNK`, so no single message is huge.
fn emit_output(sink: &dyn SessionSink, data: Vec<u8>) {
    for chunk in data.chunks(OUTPUT_CHUNK) {
        sink.output(chunk.to_vec());
    }
}
