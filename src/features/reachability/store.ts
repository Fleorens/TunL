// Availability probes: the results of the last probe per connection.
import { create } from "zustand";
import type { ProbeResult } from "@/bindings/ProbeResult";
import { notifyError } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import { mergeResults } from "./reachability-model";

interface ReachabilityState {
  /** The last known result per connection id. */
  results: Readonly<Record<string, ProbeResult>>;
  /** Probe `ids`, merge the batch into the results. A no-op when `ids` is empty. */
  refresh: (ids: string[]) => Promise<void>;
  /** Forget every result (probes disabled, or the first render). */
  clear: () => void;
}

export const useReachability = create<ReachabilityState>()((set) => ({
  results: {},

  async refresh(ids) {
    if (ids.length === 0) return;
    try {
      const batch = await ipc.probeCheck(ids);
      set((state) => ({ results: mergeResults(state.results, batch) }));
    } catch (error) {
      notifyError(error);
    }
  },

  clear() {
    set({ results: {} });
  },
}));
