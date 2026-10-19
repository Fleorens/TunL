// Pure rules for what a probe result means for a connection's dot and latency.
import type { Status } from "@/components/StatusDot";
import type { Connection } from "@/bindings/Connection";
import type { ProbeResult } from "@/bindings/ProbeResult";

/** The dot a probe result (or the absence of one) should show. */
export function dotStatus(result: ProbeResult | undefined): Status {
  switch (result?.status) {
    case "online":
      return "online";
    case "offline":
      return "offline";
    // Skipped (behind a bastion) or not probed yet: the dot stays unknown.
    default:
      return "unknown";
  }
}

/** The latency of an online result, or `null` (an offline, skipped, or missing result has none). */
export function latencyOf(result: ProbeResult | undefined): number | null {
  if (result?.status !== "online") return null;
  return result.latencyMs ?? null;
}

/**
 A new record where the ids of `batch` replace their old result, the others kept untouched. The
 `previous` record is not mutated: its values are copied, and the batch values are spread in.
 */
export function mergeResults(
  previous: Readonly<Record<string, ProbeResult>>,
  batch: readonly ProbeResult[],
): Record<string, ProbeResult> {
  const replaced: Record<string, ProbeResult> = {};
  for (const result of batch) {
    replaced[result.connectionId] = result;
  }
  return { ...previous, ...replaced };
}

/**
 A string that changes with the set of connections, and each one's id, host, port and jump host. React
 compares effect dependencies by value, so this (not the connections array itself) keeps the polling
 in step with the list without re-triggering on unrelated reshuffles.
 */
export function probeKey(connections: readonly Pick<Connection, "id" | "host" | "port" | "jumpHostId">[]): string {
  return connections
    .map((connection) => `${connection.id}:${connection.host}:${connection.port}:${connection.jumpHostId ?? ""}`)
    .join("|");
}
