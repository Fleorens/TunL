// Mock probes, as the status dots of the browser UI show them.
//
// The probe is a TCP connect only: a direct host either answers or not, one behind a bastion is never
// probed (S15), and the latency is fixed so captures stay stable.
import type { ProbeResult } from "@/bindings/ProbeResult";
import type { Handler } from "./data";
import { arg } from "./data";

/** The mock's connections whose port refuses: their dot goes offline. */
export const MOCK_OFFLINE = ["win-desktop", "kiosk-01"];

/** A fixed latency, in milliseconds, for an answering host (`2 + (name.length * 7) % 40`). */
function fixedLatency(name: string): number {
  return 2 + ((name.length * 7) % 40);
}

export const probeHandlers: Record<string, Handler<Record<string, unknown>>> = {
  probe_check(state, args) {
    const { ids } = arg<{ ids: string[] }>(args);
    const enabled = state.settings.reachability.enabled;
    const byId = new Map(state.connections.map((connection) => [connection.id, connection]));

    // The backend omits unknown ids and keeps `ids` order; the mock does the same.
    const results = ids.flatMap((id): ProbeResult[] => {
      const connection = byId.get(id);
      if (!connection) {
        return [];
      }
      if (!enabled || connection.jumpHostId != null) {
        // Probes off, or behind a bastion (S15): never probed, the dot stays unknown.
        return [{ connectionId: id, status: "skipped", latencyMs: null }];
      }
      if (MOCK_OFFLINE.includes(connection.name)) {
        return [{ connectionId: id, status: "offline", latencyMs: null }];
      }
      return [{ connectionId: id, status: "online", latencyMs: fixedLatency(connection.name) }];
    });

    return { state, result: results };
  },
};
