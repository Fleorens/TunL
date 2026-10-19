//! The `probe_check` command: probe a set of connections and return their availability.
use std::collections::HashMap;

use uuid::Uuid;
use tauri::State;

use crate::error::AppResult;
use crate::model::Connection;
use crate::probe::{PROBE_TIMEOUT, MAX_PARALLEL_PROBES, ProbeResult, ProbeStatus, probe_all};
use crate::state::AppState;

/// Probe the connections named by `ids` (as `src/lib/ipc.ts` sends them), in that order.
///
/// Unknown ids are omitted. When probes are disabled, every known connection is `Skipped` with no
/// network access; otherwise all of them are probed with the fixed timeout and parallelism.
#[tauri::command]
pub async fn probe_check(
    state: State<'_, AppState>,
    ids: Vec<Uuid>,
) -> AppResult<Vec<ProbeResult>> {
    // Connections by id, then the ones asked for, in `ids` order (unknown ids dropped).
    let by_id: HashMap<Uuid, Connection> = state
        .get_store()
        .await
        .connections
        .into_iter()
        .map(|connection| (connection.id, connection))
        .collect();
    let ordered: Vec<Connection> = ids
        .iter()
        .filter_map(|id| by_id.get(id).cloned())
        .collect();

    if !state.get_settings().await.reachability.enabled {
        return Ok(ordered
            .into_iter()
            .map(|connection| ProbeResult {
                connection_id: connection.id,
                status: ProbeStatus::Skipped,
                latency_ms: None,
            })
            .collect());
    }

    Ok(probe_all(&ordered, PROBE_TIMEOUT, MAX_PARALLEL_PROBES).await)
}
