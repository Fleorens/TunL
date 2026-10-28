//! Launch a shell on an SSH connection and run it: bytes in, bytes out, sized and cancelled (T19).
//!
//! `open_shell` opens a session channel and asks for a PTY and a shell. `pump` runs the channel: it
//! forwards the shell's bytes to the sink in bounded chunks (S10), applies the UI's writes, and ends
//! cleanly when the tab closes, the remote closes, or the process exits.
use tokio::sync::mpsc;

use russh::client::{Handle, Msg};
use russh::{Channel, ChannelMsg, ChannelReadHalf, ChannelWriteHalf};
use tokio_util::sync::CancellationToken;

use crate::error::{AppError, AppResult};
use crate::sessions::{CloseReason, SessionSink, ShellInput};
use crate::ssh::error::map_russh_error;
use crate::ssh::handler::ClientHandler;

/// The largest chunk of shell output sent to the UI at once, so a huge output cannot freeze it (S10).
pub const OUTPUT_CHUNK: usize = 64 * 1024;
/// The terminal type requested on the PTY.
pub const TERM: &str = "xterm-256color";
/// Above this many unacked output bytes the shell stops being read: xterm discards what it cannot
/// show, so the shell is slowed by SSH's own flow control instead (T50, S10).
pub const ACK_HIGH_WATER: usize = 4 * 1024 * 1024;
/// Below this many unacked bytes reading resumes, after having paused at the high water mark.
pub const ACK_LOW_WATER: usize = 1024 * 1024;

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
///
/// Keystrokes and resizes are written beside the loop (`write_input`), never awaited in it: while
/// reading is paused (T50), russh's session loop waits for room in the channel and stops sending, so
/// an awaited write would hold up the acks that lift the pause, and the cancel.
pub async fn pump(
    channel: Channel<Msg>,
    mut input: mpsc::UnboundedReceiver<ShellInput>,
    cancel: CancellationToken,
    sink: &dyn SessionSink,
) -> (CloseReason, Option<i32>) {
    let (mut read, write) = channel.split();
    let (outgoing, writes) = mpsc::unbounded_channel();
    let writer = write_input(&write, writes);
    tokio::pin!(writer);
    let mut exit_status: Option<i32> = None;
    // Output bytes pushed to the sink but not yet acked by the terminal. When it reaches the high
    // water mark, reading the channel pauses (flow control); it resumes below the low water mark.
    let mut unacked: usize = 0;
    let mut paused = false;
    loop {
        tokio::select! {
            _ = cancel.cancelled() => {
                // A closed tab ends the channel and reports it as the user's own close.
                close_channel(read, &write).await;
                return (CloseReason::UserClosed, None);
            }
            message = read.wait(), if !paused => {
                match message {
                    // The shell's output, whether on stdout or stderr (S8: never logged). It raises
                    // `unacked`; once past the high water mark the channel stops being read.
                    Some(ChannelMsg::Data { data } | ChannelMsg::ExtendedData { data, .. }) => {
                        emit_output(sink, &data);
                        unacked += data.len();
                        if unacked >= ACK_HIGH_WATER {
                            paused = true;
                        }
                    }
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
            // A keystroke could not be written: the channel is gone.
            () = &mut writer => return (CloseReason::Error, None),
            input = input.recv() => {
                match input {
                    // The terminal finished displaying `bytes`: free that much of the flow control.
                    // Reading resumes once below the low water mark.
                    Some(ShellInput::Ack(bytes)) => {
                        unacked = unacked.saturating_sub(bytes);
                        if unacked <= ACK_LOW_WATER {
                            paused = false;
                        }
                    }
                    // Keystrokes and resizes, written in order by `write_input`.
                    Some(other) => {
                        let _ = outgoing.send(other);
                    }
                    // The task dropped its receiver: end like a cancel.
                    None => {
                        close_channel(read, &write).await;
                        return (CloseReason::UserClosed, None);
                    }
                }
            }
        }
    }
}

/// Write the UI's keystrokes and resizes to the shell, in order. Ends when a keystroke cannot be
/// written: the channel is gone.
async fn write_input(
    write: &ChannelWriteHalf<Msg>,
    mut writes: mpsc::UnboundedReceiver<ShellInput>,
) {
    while let Some(input) = writes.recv().await {
        match input {
            ShellInput::Data(bytes) => {
                if write.data_bytes(bytes).await.is_err() {
                    return;
                }
            }
            ShellInput::Resize { cols, rows } => {
                let _ = write.window_change(cols, rows, 0, 0).await;
            }
            // Acks stay in `pump`: they never reach the channel.
            ShellInput::Ack(_) => {}
        }
    }
}

/// Close the channel. The read half goes first: while reading is paused (T50), russh's session loop
/// waits for room in it, and would never send the close.
async fn close_channel(read: ChannelReadHalf, write: &ChannelWriteHalf<Msg>) {
    drop(read);
    let _ = write.close().await;
}

/// Send the shell's bytes to the UI in chunks of at most `OUTPUT_CHUNK`, so no single message is huge.
/// The received slice is split without copying it first (T49); each chunk is copied once, because
/// `SessionSink::output` takes an owned buffer.
fn emit_output(sink: &dyn SessionSink, data: &[u8]) {
    for chunk in data.chunks(OUTPUT_CHUNK) {
        sink.output(chunk.to_vec());
    }
}
