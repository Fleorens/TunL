//! TCP and the SSH handshake against a server's host key (T17b, T19b).
//!
//! `tcp_connect` opens the socket with a timeout; `handshake` runs russh's `connect_stream` on a
//! generic stream (a plain `TcpStream` here, a `direct-tcpip` channel from T22). The timeout covers
//! the TCP only, never the handshake: the user may take a while to read a host key (docs/01-architecture.md §5).
use std::borrow::Cow;
use std::sync::Arc;
use std::time::Duration;

use russh::Preferred;
use russh::client::{Config, Handle, connect_stream};
use russh::keys::Algorithm;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::TcpStream;

use crate::error::{AppError, AppResult, ErrorKind};
use crate::ssh::SshContext;
use crate::ssh::handler::{ClientHandler, HostKeyTarget};

/// A stream an SSH session runs on: a TCP socket, or a `direct-tcpip` channel of the previous hop (T22).
pub trait SshStream: AsyncRead + AsyncWrite + Unpin + Send + 'static {}
impl<S: AsyncRead + AsyncWrite + Unpin + Send + 'static> SshStream for S {}

/// The russh client config: no inactivity timeout (the prompt can take a while) and a keepalive.
/// Nagle is turned off on the socket by `tcp_connect`.
pub fn client_config(keepalive_secs: u32) -> Arc<Config> {
    client_config_for(keepalive_secs, &[])
}

/// Same config, asking first for the key types already recorded for the host (OpenSSH does the same,
/// T19b): a server that only shows another type of the recorded key is not treated as unknown.
pub fn client_config_for(keepalive_secs: u32, known: &[Algorithm]) -> Arc<Config> {
    Arc::new(Config {
        inactivity_timeout: None,
        keepalive_interval: (keepalive_secs > 0)
            .then(|| Duration::from_secs(u64::from(keepalive_secs))),
        keepalive_max: 3,
        preferred: Preferred {
            key: Cow::Owned(host_key_order(known)),
            ..Preferred::default()
        },
        ..Default::default()
    })
}

/// russh's host key algorithms, those of the families in `known` first, each group in russh's own order
/// (T19b). An RSA key groups every RSA signature (a `ssh-rsa` key signs in `rsa-sha2-512`, `rsa-sha2-256`
/// or `ssh-rsa`); other types keep their exact value (the ECDSA curve counts).
pub fn host_key_order(known: &[Algorithm]) -> Vec<Algorithm> {
    let default = Preferred::default().key.into_owned();
    let mut order: Vec<Algorithm> = Vec::with_capacity(default.len());

    // The recorded families first, in the order they are given.
    for algo in known {
        if order.iter().any(|a| same_family(a, algo)) {
            continue;
        }
        order.extend(family_members(algo, &default));
    }
    // Then the rest, in russh's own order (each signature kept, so an unrecorded RSA family stays whole).
    for algo in &default {
        if !order.contains(algo) {
            order.push(algo.clone());
        }
    }
    order
}

/// Two algorithms belong to the same family: every RSA signature together, otherwise strict equality
/// (the ECDSA curve counts).
fn same_family(a: &Algorithm, b: &Algorithm) -> bool {
    match (a, b) {
        (Algorithm::Rsa { .. }, Algorithm::Rsa { .. }) => true,
        _ => a == b,
    }
}

/// Every russh signature of `algo`'s family, in russh's own order.
fn family_members(algo: &Algorithm, default: &[Algorithm]) -> Vec<Algorithm> {
    match algo {
        Algorithm::Rsa { .. } => default
            .iter()
            .filter(|a| matches!(a, Algorithm::Rsa { .. }))
            .cloned()
            .collect(),
        _ => vec![algo.clone()],
    }
}

/// Open the TCP connection only, with a `timeout`. The handshake is not covered by it.
pub async fn tcp_connect(host: &str, port: u16, timeout: Duration) -> AppResult<TcpStream> {
    let stream = tokio::time::timeout(timeout, TcpStream::connect((host, port)))
        .await
        .map_err(|_| {
            AppError::new(
                ErrorKind::Timeout,
                format!(
                    "no answer from {host}:{port} within {:.1} s",
                    timeout.as_secs_f32()
                ),
            )
        })?;
    match stream {
        Ok(stream) => {
            // Nagle off: a keystroke should leave the socket at once.
            let _ = stream.set_nodelay(true);
            Ok(stream)
        }
        Err(error) if error.kind() == std::io::ErrorKind::ConnectionRefused => Err(AppError::new(
            ErrorKind::Network,
            format!("connection refused by {host}:{port}"),
        )),
        Err(error) => {
            log::warn!("tcp connect to {host}:{port} failed: {error}");
            Err(AppError::new(
                ErrorKind::Network,
                format!("cannot reach {host}:{port}"),
            ))
        }
    }
}

/// The SSH handshake on an already-open stream: russh negotiates the session, running
/// `ClientHandler::check_server_key` on the server's key. Not authenticated yet (T18).
pub async fn handshake<S>(
    stream: S,
    target: HostKeyTarget,
    config: Arc<Config>,
    ctx: &SshContext,
) -> AppResult<Handle<ClientHandler>>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let handle = connect_stream(config, stream, ClientHandler::new(target, ctx.clone())).await?;
    Ok(handle)
}
