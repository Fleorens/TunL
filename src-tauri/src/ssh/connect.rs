//! TCP and the SSH handshake against a server's host key (T17b).
//!
//! `tcp_connect` opens the socket with a timeout; `handshake` runs russh's `connect_stream` on a
//! generic stream (a plain `TcpStream` here, a `direct-tcpip` channel from T22). The timeout covers
//! the TCP only, never the handshake: the user may take a while to read a host key (docs/01-architecture.md §5).
use std::sync::Arc;
use std::time::Duration;

use russh::client::{Config, Handle, connect_stream};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::TcpStream;

use crate::error::{AppError, AppResult, ErrorKind};
use crate::ssh::SshContext;
use crate::ssh::handler::{ClientHandler, HostKeyTarget};

/// The russh client config: no inactivity timeout (the prompt can take a while) and a keepalive.
/// Nagle is turned off on the socket by `tcp_connect`.
pub fn client_config(keepalive_secs: u32) -> Arc<Config> {
    Arc::new(Config {
        inactivity_timeout: None,
        keepalive_interval: (keepalive_secs > 0)
            .then(|| Duration::from_secs(u64::from(keepalive_secs))),
        keepalive_max: 3,
        ..Default::default()
    })
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
