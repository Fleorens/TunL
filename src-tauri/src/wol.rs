//! Wake-on-LAN: build and send the magic packet, wait for the host's port to answer, and run the Wake
//! step of a session (docs/01-architecture.md §5, this sheet T29).
//!
//! A broadcast UDP packet leaves the machine even if the host is already up (simpler than probing first);
//! the port wait then tells a session whether the host came alive (docs/06-securite.md S8, S15).
use std::net::{Ipv4Addr, UdpSocket};
use std::time::{Duration, Instant};

use tokio_util::sync::CancellationToken;
use ts_rs::TS;

use crate::error::{AppError, AppResult, ErrorKind};
use crate::model::{Connection, WolConfig};
use crate::sessions::{SessionSink, StepKind};
use crate::ssh::connect::tcp_connect;
use crate::ssh::session::connect_step;

/// How often the wake waits for the host's port to answer while it boots.
pub const WAKE_POLL_INTERVAL: Duration = Duration::from_secs(2);

/// The timeout error a port that never answers produces.
fn wake_timeout(host: &str, port: u16, total: Duration) -> AppError {
    AppError::new(
        ErrorKind::Timeout,
        format!(
            "{host}:{port} did not wake up within {:.1} s",
            total.as_secs_f32()
        ),
    )
}

/// The wake target of a connection: its address, and the WoL configuration to send.
#[derive(Debug, Clone, PartialEq, Eq, TS)]
pub struct WakeTarget {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub config: WolConfig,
}

/// Build the magic packet: 6 × `0xFF`, then the MAC repeated 16 times (102 octets). `mac` is the stored
/// `AA:BB:CC:DD:EE:FF` form; anything that is not six hex octets separated by `:` is a validation error.
pub fn magic_packet(mac: &str) -> AppResult<[u8; 102]> {
    let octets = mac.split(':').collect::<Vec<_>>();
    if octets.len() != 6 {
        return Err(AppError::validation("wol.mac", "is not a MAC address"));
    }
    let mut bytes = [0u8; 6];
    for (index, group) in octets.iter().enumerate() {
        bytes[index] = u8::from_str_radix(group, 16)
            .map_err(|_| AppError::validation("wol.mac", "is not a MAC address"))?;
    }

    let mut packet = [0u8; 102];
    for slot in packet[..6].iter_mut() {
        *slot = 0xFF;
    }
    for chunk in packet[6..].as_chunks_mut::<6>().0 {
        chunk.copy_from_slice(&bytes);
    }
    Ok(packet)
}

/// Send `config`'s packet, in UDP, to `broadcast:port`.
pub async fn send_magic_packet(config: &WolConfig) -> AppResult<()> {
    let packet = magic_packet(&config.mac)?;

    let broadcast: Ipv4Addr = config
        .broadcast
        .parse()
        .map_err(|_| AppError::validation("wol.broadcast", "is not an IPv4 address"))?;

    let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).map_err(|error| {
        log::warn!("cannot open a UDP socket: {error}");
        AppError::new(ErrorKind::Wol, "cannot open a UDP socket")
    })?;
    if let Err(error) = socket.set_broadcast(true) {
        log::warn!("cannot enable broadcast: {error}");
        return Err(AppError::new(ErrorKind::Wol, "cannot enable broadcast"));
    }

    match socket.send_to(&packet, (broadcast, config.port)) {
        Err(error) => {
            log::warn!("cannot send the magic packet: {error}");
            Err(AppError::new(
                ErrorKind::Wol,
                "cannot send the magic packet",
            ))
        }
        Ok(_) => {
            log::info!(
                "sent the magic packet to {} on {}:{}",
                config.mac,
                broadcast,
                config.port
            );
            Ok(())
        }
    }
}

/// Try `host:port` every `every`, for `total` at most. Succeeds as soon as the port answers; a refusal
/// returns at once (without this wait-out, the loop would spin to empty); the time running out is a timeout.
pub async fn wait_for_port(
    host: &str,
    port: u16,
    total: Duration,
    every: Duration,
) -> AppResult<()> {
    let started = Instant::now();
    loop {
        let remaining = total.checked_sub(started.elapsed());
        let Some(remaining) = remaining else {
            return Err(wake_timeout(host, port, total));
        };
        if remaining.is_zero() {
            return Err(wake_timeout(host, port, total));
        }

        // Bound each attempt by the shorter of the poll interval and the time left, so the last round
        // never overshoots `total`.
        let budget = std::cmp::min(every, remaining);
        match tcp_connect(host, port, budget).await {
            Ok(_stream) => return Ok(()),
            Err(_) => {
                // The attempt is done (a refusal comes back fast, or `budget` elapsed). Wait out the
                // rest of the round so a refused port does not spin the loop to empty.
                let rest = budget - started.elapsed().min(budget);
                if !rest.is_zero() {
                    tokio::time::sleep(rest).await;
                }
            }
        }
    }
}

/// The packet, then the wait for `config.wait_timeout_secs` whole seconds.
pub async fn wake_and_wait(
    config: &WolConfig,
    host: &str,
    port: u16,
    every: Duration,
) -> AppResult<()> {
    send_magic_packet(config).await?;
    wait_for_port(
        host,
        port,
        Duration::from_secs(config.wait_timeout_secs as u64),
        every,
    )
    .await
}

/// Whether a connection should be woken before connecting: a WoL config that asks for it, and that is not
/// behind a bastion (a broadcast from here would not reach the host's network, docs/06 S15).
pub fn wake_target(connection: &Connection) -> Option<WakeTarget> {
    let wol = connection.wol.as_ref()?;
    if !wol.wake_before_connect || connection.jump_host_id.is_some() {
        return None;
    }
    Some(WakeTarget {
        name: connection.name.clone(),
        host: connection.host.clone(),
        port: connection.port,
        config: wol.clone(),
    })
}

/// Run the Wake step of a session: the packet, then the port wait. `true` when it finished, `false` when it
/// failed or the tab was closed (the caller then skips the connection).
pub async fn run_wake_step(
    wake: &WakeTarget,
    every: Duration,
    cancel: CancellationToken,
    sink: &dyn SessionSink,
) -> bool {
    connect_step(cancel, sink, StepKind::Wake, &wake.name, || {
        wake_and_wait(&wake.config, &wake.host, wake.port, every)
    })
    .await
    .is_ok()
}
