//! Availability probes: a TCP connect to each connection's port, nothing sent (S15).
//!
//! TunL opens the socket at startup and at a fixed interval, then drops it at once. A host behind a
//! bastion is never probed directly (it would be reached from the wrong network and reveal TunL's name
//! to the local DNS), so its result is `Skipped` with no network access at all.
use std::time::{Duration, Instant};

use serde::Serialize;
use tokio::net::TcpStream;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;
use ts_rs::TS;
use uuid::Uuid;

use crate::model::Connection;

/// The probe never holds a socket longer than this.
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(2);
/// A hard cap on concurrent connects, so a long list of connections cannot open the whole network.
pub const MAX_PARALLEL_PROBES: usize = 16;

/// Whether a connection's port answered.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ProbeStatus {
    Online,
    Offline,
    Skipped,
}

/// One connection's probe result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProbeResult {
    pub connection_id: Uuid,
    pub status: ProbeStatus,
    pub latency_ms: Option<u32>,
}

/// A TCP connect to `host:port` in `timeout` at most, dropped at once. `Some(connect duration)` if the
/// port answered; `None` on refusal, unknown name, unreachable network, or timeout. Nothing is written.
pub async fn probe(host: &str, port: u16, timeout: Duration) -> Option<Duration> {
    let started = Instant::now();
    match tokio::time::timeout(timeout, TcpStream::connect((host, port))).await {
        Ok(Ok(stream)) => {
            // S15: connect only, no data. Drop immediately so nothing lingers on the socket.
            drop(stream);
            Some(started.elapsed())
        }
        // Connection refused, DNS error, unreachable, or timeout: nothing answered.
        _ => None,
    }
}

/// Probe every connection, `max_parallel` at a time, results in the order of `connections`.
///
/// A connection with a jump host is `Skipped` without any task (no network access). The others each get
/// one task, gated by a semaphore; each result is placed back in its input slot, whatever the arrival
/// order. A task that errors counts as `Offline` (the slot's initial value).
pub async fn probe_all(
    connections: &[Connection],
    timeout: Duration,
    max_parallel: usize,
) -> Vec<ProbeResult> {
    // Every slot starts `Offline`; skipped and errored tasks keep it.
    let mut results: Vec<ProbeResult> = connections
        .iter()
        .map(|connection| ProbeResult {
            connection_id: connection.id,
            status: ProbeStatus::Offline,
            latency_ms: None,
        })
        .collect();

    let mut join_set: JoinSet<(usize, ProbeResult)> = JoinSet::new();
    let semaphore = std::sync::Arc::new(Semaphore::new(max_parallel));

    for (index, connection) in connections.iter().enumerate() {
        // A bastion target is never probed directly: no task, no network access.
        if connection.jump_host_id.is_some() {
            results[index] = ProbeResult {
                connection_id: connection.id,
                status: ProbeStatus::Skipped,
                latency_ms: None,
            };
            continue;
        }

        // Hold the permit for the task's whole lifetime, so at most `max_parallel` connects run.
        let permit = match semaphore.clone().acquire_owned().await {
            Ok(permit) => permit,
            // The semaphore is never closed here; only a closed semaphore reaches this branch.
            Err(_) => continue,
        };
        // Own a copy: the future must outlive this call, and the reference borrows `connections`.
        let connection = connection.clone();
        join_set.spawn(async move {
            let latency = probe(connection.host.as_str(), connection.port, timeout).await;
            // Release the slot now that the probe is done.
            drop(permit);
            (
                index,
                ProbeResult {
                    connection_id: connection.id,
                    status: latency
                        .map(|_| ProbeStatus::Online)
                        .unwrap_or(ProbeStatus::Offline),
                    latency_ms: latency.map(|d| d.as_millis() as u32),
                },
            )
        });
    }

    while let Some(entry) = join_set.join_next().await {
        // A task that would error counts as Offline (already the slot's value).
        if let Ok((index, probe_result)) = entry {
            results[index] = probe_result;
        }
    }

    results
}
