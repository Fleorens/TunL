// T30: what a probe result means for a connection's dot and latency.
import { describe, expect, test } from "vitest";
import type { ProbeResult } from "@/bindings/ProbeResult";
import { dotStatus, latencyOf, mergeResults, probeKey } from "./reachability-model";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";

function result(connectionId: string, status: ProbeResult["status"], latencyMs: number | null) {
  return { connectionId, status, latencyMs } satisfies ProbeResult;
}

describe("dotStatus", () => {
  test("online and offline map to their dot; skipped and not probed yet are unknown", () => {
    expect(dotStatus(result(A, "online", 4))).toBe("online");
    expect(dotStatus(result(A, "offline", null))).toBe("offline");
    expect(dotStatus(result(A, "skipped", null))).toBe("unknown");
    expect(dotStatus(undefined)).toBe("unknown");
  });
});

describe("latencyOf", () => {
  test("only an online result has a latency", () => {
    expect(latencyOf(result(A, "online", 12))).toBe(12);
    expect(latencyOf(result(A, "online", null))).toBeNull();
    expect(latencyOf(result(A, "offline", 12))).toBeNull();
    expect(latencyOf(undefined)).toBeNull();
  });
});

describe("mergeResults", () => {
  test("a batch replaces its ids and keeps the others, without touching the previous record", () => {
    const previous = { [A]: result(A, "online", 3), [B]: result(B, "online", 9) };
    const next = mergeResults(previous, [result(B, "offline", null)]);
    expect(next).toEqual({ [A]: result(A, "online", 3), [B]: result(B, "offline", null) });
    expect(previous[B].status).toBe("online");
    expect(next).not.toBe(previous);
  });
});

describe("probeKey", () => {
  const web = { id: A, host: "10.0.0.12", port: 22, jumpHostId: null };

  test("changes with the address, the port, the jump host and the set of connections", () => {
    const key = probeKey([web]);
    expect(probeKey([{ ...web }])).toBe(key);
    expect(probeKey([{ ...web, host: "10.0.0.13" }])).not.toBe(key);
    expect(probeKey([{ ...web, port: 2222 }])).not.toBe(key);
    expect(probeKey([{ ...web, jumpHostId: B }])).not.toBe(key);
    expect(probeKey([web, { ...web, id: B }])).not.toBe(key);
    expect(probeKey([])).toBe("");
  });
});
