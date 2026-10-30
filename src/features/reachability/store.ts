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
  /** Whether the next failure warns. A success re-arms it, so a probe that keeps failing warns once. */
  alertArmed: boolean;
}

export const useReachability = create<ReachabilityState>()((set) => ({
  results: {},
  alertArmed: true,

  async refresh(ids) {
    if (ids.length === 0) return;
    try {
      const batch = await ipc.probeCheck(ids);
      set((state) => ({ results: mergeResults(state.results, batch), alertArmed: true }));
    } catch (error) {
      // Warn once per run of failures: toast and disarm, stay silent until the next success re-arms.
      if (!useReachability.getState().alertArmed) return;
      notifyError(error);
      set({ alertArmed: false });
    }
  },

  clear() {
    set({ results: {} });
  },
}));
