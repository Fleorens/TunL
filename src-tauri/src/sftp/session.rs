//! The SFTP tab's connection: open the "sftp" subsystem on a channel, and run the tab until it ends
//! (T24). The steps are the same as a shell's (docs/01 §5, §6); the `Open` step opens the subsystem
//! instead of a shell, and the tab stays alive as long as its session is registered.
use std::sync::Arc;
use std::time::Duration;

use russh::client::Handle;
use russh_sftp::client::SftpSession;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::error::{AppError, AppResult, ErrorKind};
use crate::sessions::{CloseReason, SessionEvent, SessionSink, StepKind};
use crate::sftp::SftpRegistry;
use crate::sftp::ops::map_sftp_error;
use crate::ssh::SshContext;
use crate::ssh::error::map_russh_error;
use crate::ssh::handler::ClientHandler;
use crate::ssh::link::establish;
use crate::ssh::session::{SshTarget, connect_step};

/// How often the tab checks that its SSH connection is still alive (docs/01 §6).
pub const LIVENESS_INTERVAL: Duration = Duration::from_secs(2);

/// Everything a tab needs to open the SFTP subsystem of its target.
#[derive(Debug)]
pub struct SftpRun {
    pub id: Uuid,
    pub target: SshTarget,
    pub cancel: CancellationToken,
}

/// The "sftp" subsystem on a new channel of `handle` (docs/01 §5).
///
/// Opens a session channel, asks for the subsystem, then wraps the channel in an SFTP session. A
/// refused subsystem is a clear `sftp` error, the server's own message logged (S7).
pub async fn open_sftp(handle: &Handle<ClientHandler>) -> AppResult<SftpSession> {
    let channel = handle
        .channel_open_session()
        .await
        .map_err(|error| map_russh_error(&error))?;
    if let Err(error) = channel.request_subsystem(true, "sftp").await {
        log::warn!("the SFTP subsystem was refused on this connection: {error}");
        return Err(AppError::new(
            ErrorKind::Sftp,
            "the server has no SFTP subsystem",
        ));
    }
    SftpSession::new(channel.into_stream())
        .await
        .map_err(|error| map_sftp_error("open", "sftp", &error))
}

/// Run one SFTP tab (docs/01 §5, §6): connect, open the subsystem, register the session, then wait
/// until the tab closes or the connection is lost. `registry` holds the session while it is open, and
/// the cleanup at the end removes it and disconnects the link cleanly.
pub async fn run_sftp_session(
    ctx: SshContext,
    run: SftpRun,
    sink: Arc<dyn SessionSink>,
    registry: Arc<SftpRegistry>,
) {
    let SftpRun { id, target, cancel } = run;

    // The authenticated link: bastions, target, host key, authentication. Stops on the first failure
    // or cancel (its events already gone).
    let Some(link) = establish(&ctx, &target, id, cancel.clone(), &*sink).await else {
        return;
    };

    // Open the SFTP subsystem on the link's target.
    let Ok(sftp) = connect_step(cancel.clone(), &*sink, StepKind::Open, "sftp", || {
        open_sftp(&link.target)
    })
    .await
    else {
        return;
    };

    // The session is registered while the tab is connected, so the sftp_* commands can find it.
    registry.insert(id, Arc::new(sftp));
    sink.event(SessionEvent::Connected);

    // Wait for the tab to close (the cancel token, set by `session_close`) or the connection to be
    // lost, checked every liveness interval.
    let reason = loop {
        tokio::select! {
            _ = cancel.cancelled() => break CloseReason::UserClosed,
            _ = tokio::time::sleep(LIVENESS_INTERVAL) => {
                if link.target.is_closed() {
                    break CloseReason::RemoteClosed;
                }
            }
        }
    };

    registry.remove(id);
    sink.event(SessionEvent::Closed {
        reason,
        exit_status: None,
    });
    link.disconnect().await;
}
