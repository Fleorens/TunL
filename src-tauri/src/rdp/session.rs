//! Run one RDP tab: behind a bastion it establishes the SSH link and opens a local tunnel, then it
//! launches FreeRDP (direct, or at `127.0.0.1:<tunnel>`), follows it, and reports the end (docs/01 §8).
//!
//! `resolve_rdp` turns a stored RDP connection into its target (the bastion, if any, kept as an SSH
//! target). `run_rdp_session` runs the steps: the tunnel behind a bastion, then the launch, then the
//! client. In every case it stops the tunnel and disconnects the link when it ends.
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::model::{ProtocolSettings, RdpSettings, SshDefaults};
use crate::rdp::args::{RdpCredentials, RdpEndpoint, build_args};
use crate::rdp::launch::{launch, watch};
use crate::sessions::{SessionEvent, SessionSink, StepKind};
use crate::ssh::SshContext;
use crate::ssh::forward::{bind_local, forward};
use crate::ssh::link::{SshLink, establish};
use crate::ssh::session::{SessionTarget, SshTarget, connect_step, resolve_target};
use crate::store::Store;

/// Everything a stored RDP connection connects to: its address, and the bastion as an SSH target.
#[derive(Debug, Clone)]
pub struct RdpTarget {
    pub connection_id: Uuid,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub settings: RdpSettings,
    /// The bastion, as a SSH target with its own chain; `None` for a direct connection.
    pub via: Option<SshTarget>,
}

/// Resolve a stored connection as an RDP target (this sheet): it must exist and be RDP; its jump host,
/// if any, becomes the bastion kept as a SSH target (with its own chain, user and authentication).
pub fn resolve_rdp(
    connection_id: Uuid,
    store: &Store,
    defaults: &SshDefaults,
    default_user: Option<&str>,
) -> AppResult<RdpTarget> {
    let connection = store
        .connections
        .iter()
        .find(|c| c.id == connection_id)
        .ok_or_else(|| AppError::not_found(format!("connection {connection_id}")))?;

    let ProtocolSettings::Rdp(settings) = &connection.settings else {
        return Err(AppError::validation("protocol", "is not RDP"));
    };

    // The bastion, if any, keeps its own chain, user and authentication (resolved as a SSH target).
    let via = match connection.jump_host_id {
        Some(jump_id) => Some(resolve_target(
            &SessionTarget::Saved {
                connection_id: jump_id,
            },
            store,
            defaults,
            default_user,
        )?),
        None => None,
    };

    Ok(RdpTarget {
        connection_id: connection.id,
        name: connection.name.clone(),
        host: connection.host.clone(),
        port: connection.port,
        username: connection.username.clone(),
        settings: settings.clone(),
        via,
    })
}

/// Everything a running RDP tab needs, handed to `run_rdp_session` (this sheet).
#[derive(Debug)]
pub struct RdpRun {
    pub id: Uuid,
    pub target: RdpTarget,
    pub credentials: RdpCredentials,
    pub client: PathBuf,
    pub cancel: CancellationToken,
}

/// Establish the link behind a bastion, open the local tunnel, and point the target at it.
///
/// Returns the link on success (so the caller can disconnect it), or `None` if the link or the tunnel
/// step failed — the steps already went out, and the link is already disconnected in that case.
async fn establish_bastion(
    ctx: &SshContext,
    id: Uuid,
    via: SshTarget,
    target: &mut RdpTarget,
    cancel: CancellationToken,
    sink: &dyn SessionSink,
) -> Option<Arc<SshLink>> {
    let link = establish(ctx, &via, id, cancel.clone(), sink).await?;
    let link = Arc::new(link);

    // The `Open` step opens a free loopback port; nothing off this machine can reach it (S15).
    let listener = match connect_step(cancel.clone(), sink, StepKind::Open, "tunnel", || async {
        bind_local().await
    })
    .await
    {
        Ok(listener) => listener,
        Err(()) => {
            link.disconnect().await;
            return None;
        }
    };

    let local_port = match listener.local_addr() {
        Ok(addr) => addr.port(),
        Err(error) => {
            log::warn!("cannot read the tunnel port: {error}");
            link.disconnect().await;
            return None;
        }
    };

    // Log the tunnel for the RDP card, then point FreeRDP at it.
    let remote_host = target.host.clone();
    let remote_port = target.port;
    sink.event(SessionEvent::Log {
        line: format!("tunnel 127.0.0.1:{local_port} → {remote_host}:{remote_port}"),
    });
    target.host = "127.0.0.1".to_string();
    target.port = local_port;

    // Forward each accepted connection over the bastion, keeping the link alive in the task (a
    // `Handle` is not `Clone`, so the whole `Arc<SshLink>` travels with the task, this sheet).
    let forward_link = link.clone();
    tokio::spawn(async move {
        forward(
            listener,
            &forward_link.target,
            &remote_host,
            remote_port,
            cancel.child_token(),
        )
        .await;
    });

    Some(link)
}

/// The label of the launch step: the client's file name (e.g. `sdl-freerdp3`).
fn client_name(client: &Path) -> String {
    client
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Run one RDP tab (this sheet): the tunnel behind a bastion, the launch, the client, then the end.
///
/// The launch builds the arguments and starts the client in one task, so a refused argument fails the
/// step without starting the client. In every case the tunnel is stopped and the link disconnected.
pub async fn run_rdp_session(ctx: SshContext, run: RdpRun, sink: Arc<dyn SessionSink>) {
    let RdpRun {
        id,
        mut target,
        credentials,
        client,
        cancel,
    } = run;

    // Behind a bastion: establish the link and open the tunnel (the target's address becomes the tunnel).
    let link: Option<Arc<SshLink>> = match target.via.clone() {
        None => None,
        Some(via) => {
            match establish_bastion(&ctx, id, via, &mut target, cancel.clone(), &*sink).await {
                Some(link) => Some(link),
                None => {
                    // The link or the tunnel step failed: its steps went out. Stop.
                    cancel.cancel();
                    return;
                }
            }
        }
    };

    // The launch: build the arguments, then start the client, in one task (a refused argument fails it).
    let label = client_name(&client);
    let endpoint = RdpEndpoint {
        name: &target.name,
        host: &target.host,
        port: target.port,
    };
    let child = match connect_step(cancel.clone(), &*sink, StepKind::Launch, &label, || async {
        let args = build_args(&endpoint, &target.settings, &credentials)?;
        launch(&client, &args).await
    })
    .await
    {
        Ok(child) => child,
        Err(()) => {
            cancel.cancel();
            if let Some(link) = link {
                link.disconnect().await;
            }
            return;
        }
    };

    // The client runs until it ends, then the tab closes.
    sink.event(SessionEvent::Connected);
    let (reason, exit_status) = watch(child, cancel.clone(), &*sink).await;
    sink.event(SessionEvent::Closed {
        reason,
        exit_status,
    });

    // Stop the tunnel, then disconnect the link cleanly (every case).
    cancel.cancel();
    if let Some(link) = link {
        link.disconnect().await;
    }
}
