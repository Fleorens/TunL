//! The bastion chain of a connection (T22): resolve it, and open a hop through a previous one.
//!
//! `resolve_chain` walks the `jump_host_id` links of a connection and returns its bastions in the order
//! TunL dials them (the first, opened by TCP, last). `open_through` opens `host:port` through an already
//! authenticated bastion, via a `direct-tcpip` channel (docs/01 §5).
use std::collections::HashSet;
use std::time::Duration;

use russh::ChannelStream;
use russh::client::{Handle, Msg};
use uuid::Uuid;

use crate::error::{AppError, AppResult, ErrorKind};
use crate::model::{Connection, MAX_JUMP_HOSTS, Protocol};
use crate::ssh::SshContext;
use crate::ssh::auth::AuthTarget;
use crate::ssh::connect::{SshStream, client_config_for, handshake_timed, tcp_connect};
use crate::ssh::handler::{ClientHandler, HostKeyTarget};
use crate::ssh::session::SshTarget;

/// Walk `connection`'s `jump_host_id` links and return its bastions, outermost first (the one opened by
/// TCP), without `connection`.
///
/// The chain is followed from the target's jump host up to the first bastion, then reversed (the store
/// keeps it in the opposite order). Refused, as the store refuses it at saving, by a hand-edited file or a
/// bastion deleted since: a link that no longer exists, a non-SSH link, a loop (even back to `connection`),
/// or more than `MAX_JUMP_HOSTS` bastions.
pub fn resolve_chain<'a>(
    connection: &Connection,
    connections: &'a [Connection],
) -> AppResult<Vec<&'a Connection>> {
    let mut visited: HashSet<Uuid> = HashSet::from([connection.id]);
    let mut chain: Vec<&Connection> = Vec::new();
    let mut current = connection.jump_host_id;
    while let Some(id) = current {
        if !visited.insert(id) {
            // A link already on the chain (or `connection` itself): the chain loops back.
            return Err(AppError::validation(
                "jumpHostId",
                "the jump host chain loops",
            ));
        }
        let hop = connections
            .iter()
            .find(|c| c.id == id)
            .ok_or_else(|| AppError::not_found(format!("jump host {id}")))?;
        if hop.settings.protocol() != Protocol::Ssh {
            return Err(AppError::validation(
                "jumpHostId",
                "the jump host must be an SSH connection",
            ));
        }
        chain.push(hop);
        if chain.len() > MAX_JUMP_HOSTS {
            return Err(AppError::validation(
                "jumpHostId",
                &format!("the jump host chain may contain at most {MAX_JUMP_HOSTS} bastions"),
            ));
        }
        current = hop.jump_host_id;
    }
    chain.reverse();
    Ok(chain)
}

/// Open `host:port` through the already-authenticated bastion `via` (called `via_name` in errors), in
/// `timeout` at most.
///
/// The timeout covers the channel open only, never the handshake (as `tcp_connect` covers the TCP only):
/// the user may take a while to read a host key. A refused bastion is a network error naming both ends, and
/// russh's own error only in a log (docs/06, S7, S8).
pub async fn open_through(
    via: &Handle<ClientHandler>,
    via_name: &str,
    host: &str,
    port: u16,
    timeout: Duration,
) -> AppResult<ChannelStream<Msg>> {
    let channel = tokio::time::timeout(
        timeout,
        via.channel_open_direct_tcpip(host, u32::from(port), "127.0.0.1", 0),
    )
    .await
    .map_err(|_| {
        AppError::new(
            ErrorKind::Timeout,
            format!(
                "{via_name} got no answer from {host}:{port} within {:.1} s",
                timeout.as_secs_f32()
            ),
        )
    })?
    .map_err(|error| {
        log::warn!("{via_name} cannot reach {host}:{port}: {error}");
        AppError::new(
            ErrorKind::Network,
            format!("{via_name} cannot reach {host}:{port}"),
        )
    })?;
    Ok(channel.into_stream())
}

/// The stream a hop runs on: TCP for the first bastion (or a direct target), a `direct-tcpip` channel of the
/// previous bastion after (docs/01 §5). The timeout covers the stream only, never the handshake. `via_name`
/// names the bastion the channel is opened through, in errors.
pub(crate) async fn dial(
    previous: Option<&Handle<ClientHandler>>,
    via_name: &str,
    to: &SshTarget,
    connect_timeout: Duration,
) -> AppResult<Box<dyn SshStream>> {
    match previous {
        None => {
            let stream = tcp_connect(&to.host, to.port, connect_timeout).await?;
            Ok(Box::new(stream) as Box<dyn SshStream>)
        }
        Some(via) => {
            let stream = open_through(via, via_name, &to.host, to.port, connect_timeout).await?;
            Ok(Box::new(stream) as Box<dyn SshStream>)
        }
    }
}

/// Run one bastion's handshake on its stream: russh negotiates the session, checking the bastion's own host
/// key (its own host and port, so a key learned here is never recorded under the target's name, docs/01 §5).
/// The delay is the hop's connect timeout (T49).
pub(crate) async fn handshake_with(
    stream: Box<dyn SshStream>,
    to: &SshTarget,
    id: Uuid,
    ctx: &SshContext,
) -> AppResult<Handle<ClientHandler>> {
    handshake_timed(
        stream,
        HostKeyTarget {
            host: to.host.clone(),
            port: to.port,
            session_id: Some(id),
        },
        client_config_for(
            to.keepalive_secs,
            &ctx.known_hosts.algorithms(&to.host, to.port),
        ),
        ctx,
        to.connect_timeout,
    )
    .await
}

/// Open one bastion's stream, then its handshake (docs/01 §5). `previous` is the bastion before it, `via_name`
/// its name in errors, or `None`/`""` for the first, opened by TCP.
pub(crate) async fn connect_hop(
    hop: &SshTarget,
    previous: Option<&Handle<ClientHandler>>,
    via_name: &str,
    id: Uuid,
    ctx: &SshContext,
) -> AppResult<Handle<ClientHandler>> {
    let stream = dial(previous, via_name, hop, hop.connect_timeout).await?;
    handshake_with(stream, hop, id, ctx).await
}

/// Everything `authenticate` needs about a hop: its own connection id (the password read from the keyring, or
/// asked under its name), its user, host and auth plan, on this session (`id`).
pub(crate) fn auth_target_of(to: &SshTarget, id: Uuid) -> AuthTarget {
    AuthTarget {
        connection_id: to.connection_id,
        connection_name: to.connection_name.clone(),
        username: to.username.clone(),
        host: to.host.clone(),
        session_id: Some(id),
        plan: to.plan.clone(),
    }
}
