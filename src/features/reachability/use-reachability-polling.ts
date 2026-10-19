// Probe every connection right away, then on a fixed interval, and keep the results in
// `useReachability`.
import { useEffect } from "react";
import { useConnections } from "@/features/connections/store";
import { useSettings } from "@/features/settings/store";
import { probeKey } from "./reachability-model";
import { useReachability } from "./store";

/**
 Probe the connections: once right away, then every `intervalSecs` seconds.
 - Probes off: forget the results and stop.
 - No connection: nothing.
 - Each round re-reads the ids, is skipped while the window is hidden, and re-probes as soon as a
   connection is added or its address changes (the effect depends on `probeKey`, not the array).
 */
export function useReachabilityPolling() {
  const enabled = useSettings((state) => state.settings?.reachability.enabled ?? true);
  const intervalSecs = useSettings((state) => state.settings?.reachability.intervalSecs ?? 60);
  const key = probeKey(useConnections((state) => state.connections));

  useEffect(() => {
    if (!enabled) {
      useReachability.getState().clear();
      return;
    }
    // No connection: `probeKey` is "", there is nothing to probe.
    if (key === "") return;

    // A probe right away, then on a fixed interval.
    const round = () => {
      if (document.visibilityState === "hidden") return;
      const ids = useConnections.getState().connections.map((connection) => connection.id);
      void useReachability.getState().refresh(ids);
    };
    round();
    const handle = setInterval(round, intervalSecs * 1000);

    return () => clearInterval(handle);
  }, [enabled, intervalSecs, key]);
}
