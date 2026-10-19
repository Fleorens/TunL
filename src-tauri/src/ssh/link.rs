//! A reusable, authenticated SSH link through the bastion chain (T23).
//!
//! `establish` runs the steps a connection needs before it can carry a channel — the bastions, then the
//! target, its host key, its authentication — and returns an `SshLink` that keeps them all alive. The shell
//! (T19), the SFTP explorer (T24) and the RDP tunnel (T28) all open on it. It is the pre-`Open` part of
//! `run_ssh_session`, extracted so any of those three can reuse it unchanged.
use russh::Disconnect;
use russh::client::Handle;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::sessions::{SessionSink, StepKind};
use crate::ssh::auth::authenticate;
use crate::ssh::chain::{auth_target_of, connect_hop, dial, handshake_with};
use crate::ssh::session::{SshTarget, connect_step};
use crate::ssh::{SshContext, handler::ClientHandler};

/// The authenticated target and its bastions, kept alive as long as the link.
///
/// Dropping a bastion handle closes the channel on which the target (or the next bastion) runs, so the
/// link owns every handle until `disconnect`.
pub struct SshLink {
    pub target: Handle<ClientHandler>,
    pub hops: Vec<Handle<ClientHandler>>,
}

impl SshLink {
    /// Clean goodbye: the target first, then each bastion from the nearest to the first (their handles
    /// close the channels they hold open).
    pub async fn disconnect(&self) {
        let _ = self
            .target
            .disconnect(Disconnect::ByApplication, "", "en")
            .await;
        for hop in self.hops.iter().rev() {
            let _ = hop.disconnect(Disconnect::ByApplication, "", "en").await;
        }
    }
}

/// The `Hop` steps (one per bastion), `Target`, `HostKey`, `Auth`, reported by `sink`.
///
/// `None` means a step failed or was cancelled, and its events have already gone: the caller stops.
/// Otherwise the link carries an authenticated target and every bastion crossed (docs/01 §5, this sheet).
pub async fn establish(
    ctx: &SshContext,
    target: &SshTarget,
    session_id: Uuid,
    cancel: CancellationToken,
    sink: &dyn SessionSink,
) -> Option<SshLink> {
    // The bastions before the target, kept alive until the link ends (a dropped handle would close the
    // target's channel). One `Hop` step crosses each, first dialled first (T22): its stream, its handshake,
    // then its authentication.
    let mut hops: Vec<Handle<ClientHandler>> = Vec::new();
    let mut names: Vec<String> = Vec::new();
    for hop in &target.jump_hosts {
        // The channel is opened through the bastion before this one (the previous handle), named `via` in
        // errors; empty for the first, opened by TCP.
        let via_name = names.last().cloned().unwrap_or_default();
        let Ok(hop_handle) = connect_step(
            cancel.clone(),
            sink,
            StepKind::Hop,
            &hop.connection_name,
            || async {
                let mut handle = connect_hop(hop, hops.last(), &via_name, session_id, ctx).await?;
                authenticate(&mut handle, &auth_target_of(hop, session_id), ctx).await?;
                Ok(handle)
            },
        )
        .await
        else {
            return None;
        };
        hops.push(hop_handle);
        names.push(hop.connection_name.clone());
    }

    // The target, through the last bastion or by TCP when there is none.
    let address = format!("{}:{}", target.host, target.port);
    let via_name = names.last().cloned().unwrap_or_default();
    let Ok(stream) = connect_step(cancel.clone(), sink, StepKind::Target, &address, || {
        dial(hops.last(), &via_name, target, target.connect_timeout)
    })
    .await
    else {
        return None;
    };

    // Host key: russh negotiates the session and checks the server's key.
    let Ok(mut handle) = connect_step(
        cancel.clone(),
        sink,
        StepKind::HostKey,
        &target.host,
        || handshake_with(stream, target, session_id, ctx),
    )
    .await
    else {
        return None;
    };

    // Authentication.
    let auth_target = auth_target_of(target, session_id);
    let Ok(()) = connect_step(cancel, sink, StepKind::Auth, &target.username, || {
        authenticate(&mut handle, &auth_target, ctx)
    })
    .await
    else {
        return None;
    };

    Some(SshLink {
        target: handle,
        hops,
    })
}
