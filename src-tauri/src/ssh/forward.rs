//! A local port forwarded through an authenticated SSH link (T23).
//!
//! `bind_local` opens a free port on the loopback interface only — nothing off this machine can reach it
//! (docs/06, S15). `bind_tunnel` prefers the connection's own port (T28c) and falls back to `bind_local`
//! when it is taken. `forward` carries each connection accepted there over a `direct-tcpip` channel of
//! `via` to `host:port`, until `cancel` (docs/01 §8). FreeRDP connects to the local port in T28.
use std::net::Ipv4Addr;

use uuid::Uuid;

use russh::client::Handle;
use tokio::io::copy_bidirectional;
use tokio::net::TcpListener;
use tokio_util::sync::CancellationToken;

use crate::error::{AppError, AppResult, ErrorKind};
use crate::ssh::handler::ClientHandler;

/// A free port of the loopback interface only: nothing off this machine can reach it (S15).
pub async fn bind_local() -> AppResult<TcpListener> {
    TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .await
        .map_err(|error| {
            log::warn!("cannot open a local port for the tunnel: {error}");
            AppError::new(ErrorKind::Io, "cannot open a local port for the tunnel")
        })
}

/// First port of the tunnel range: above Linux's ephemeral ports (32768–60999).
pub const TUNNEL_PORT_FIRST: u16 = 61000;
/// Size of the range (61000–65535).
pub const TUNNEL_PORT_COUNT: u16 = 4536;

/// The loopback port the tunnel of a connection prefers: always the same for it.
pub fn tunnel_port(connection_id: Uuid) -> u16 {
    // The remainder is always below `TUNNEL_PORT_COUNT`, so it fits in a u16: no `as` truncation,
    // no panic (T28c).
    let remainder = connection_id.as_u128() % u128::from(TUNNEL_PORT_COUNT);
    let offset = match u16::try_from(remainder) {
        Ok(offset) => offset,
        Err(error) => {
            log::warn!("tunnel port out of range: {error}");
            0
        }
    };
    TUNNEL_PORT_FIRST + offset
}

/// The tunnel of a connection: its listener, and whether it holds the connection's own port.
///
/// `stable` is true when the listener holds `tunnel_port(id)` (so FreeRDP re-finds the certificate
/// it trusted last time, T28c), false when it fell back to a free loopback port.
pub struct TunnelListener {
    pub listener: TcpListener,
    pub stable: bool,
}

/// The connection's own port if free (stable), otherwise any free loopback port (`bind_local`).
///
/// The caller keeps `stable` to know whether the tunnel port is the connection's own one, so it can
/// adapt the certificate policy when it is not (see `tunnel_cert_policy`).
pub async fn bind_tunnel_checked(connection_id: Uuid) -> AppResult<TunnelListener> {
    match TcpListener::bind((Ipv4Addr::LOCALHOST, tunnel_port(connection_id))).await {
        Ok(listener) => Ok(TunnelListener {
            listener,
            stable: true,
        }),
        Err(error) => {
            log::info!(
                "tunnel port {} is taken, any free loopback port ({error})",
                tunnel_port(connection_id)
            );
            Ok(TunnelListener {
                listener: bind_local().await?,
                stable: false,
            })
        }
    }
}

/// The connection's own port if free, otherwise any free loopback port (`bind_local`).
pub async fn bind_tunnel(connection_id: Uuid) -> AppResult<TcpListener> {
    bind_tunnel_checked(connection_id)
        .await
        .map(|tunnel| tunnel.listener)
}

/// Carries each connection accepted on `listener` over `via` to `host:port`, until `cancel`.
///
/// Every connection opens its own `direct-tcpip` channel first, so a refused one closes only that
/// connection and the tunnel keeps listening. `cancel` stops the loop (dropping `listener`, so the port
/// closes) and ends every in-progress copy. Nothing that passes is logged (S8).
pub async fn forward(
    listener: TcpListener,
    via: &Handle<ClientHandler>,
    host: &str,
    port: u16,
    cancel: CancellationToken,
) {
    loop {
        tokio::select! {
            _ = cancel.cancelled() => break,
            accepted = listener.accept() => {
                let Ok((local, _)) = accepted else {
                    // An accept error is ignored: keep listening.
                    continue;
                };
                // Open the channel before copying: each local connection has its own, and a refusal
                // closes only that one (docs/01 §8). The open races `cancel`: a far end that never answers
                // must not keep the tunnel alive after its tab closed (lot 5 review).
                let client_port = u32::from(local.peer_addr().map(|addr| addr.port()).unwrap_or(0));
                let opened = tokio::select! {
                    _ = cancel.cancelled() => break,
                    opened = via.channel_open_direct_tcpip(host, u32::from(port), "127.0.0.1", client_port) => opened,
                };
                let via_stream = match opened {
                    Ok(channel) => channel.into_stream(),
                    Err(error) => {
                        log::warn!("cannot open a tunnel to {host}:{port}: {error}");
                        continue;
                    }
                };
                // A separate token so the relay ends on cancel without borrowing this one.
                let relay_cancel = cancel.clone();
                tokio::spawn(async move {
                    // Copy until one end closes or the tunnel is cancelled: without the select, a
                    // connection left open would outlive the tab (docs/01 §8).
                    let mut local = local;
                    let mut via_stream = via_stream;
                    tokio::select! {
                        _ = relay_cancel.cancelled() => {}
                        _ = copy_bidirectional(&mut via_stream, &mut local) => {}
                    }
                });
            }
        }
    }
}
