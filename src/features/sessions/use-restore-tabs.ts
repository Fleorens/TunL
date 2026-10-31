// Wire the "reopen last time's tabs" feature (T60): once connections and settings are loaded, load the saved
// set, save it on every session change (debounced, never before the load, one error toast per burst), and
// restore it at startup per the setting.
import { useEffect } from "react";
import type { SavedTab } from "@/bindings/SavedTab";
import { useConnections } from "@/features/connections/store";
import { useSettings } from "@/features/settings/store";
import { notifyError } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import { useRestore } from "./restore-store";
import { restorable, savedTabsOf } from "./restore-tabs";
import { useSessions } from "./store";

const SAVE_DEBOUNCE_MS = 500;

// Once per startup, not per effect run: the connections reload after an import or a retry (status `loading`, then
// `ready` again), and that must neither reopen the tabs a second time nor bring the offer back.
let loadStarted = false;
let loaded = false;
// One error toast per series of failed saves: re-armed only by a save that succeeds (like the probes, T53).
let notified = false;

/** Read last time's tabs, then reopen them or offer them, per the setting. */
function loadAndRestore(): void {
  void ipc
    .tabsLoad()
    .then((saved) => {
      // Set before opening: the tabs reopened here are then saved like any other change.
      loaded = true;
      const restorableTabs = restorable(saved, useConnections.getState().connections);
      const mode = useSettings.getState().settings?.ui.restoreTabs ?? "ask";
      if (mode === "never" || restorableTabs.length === 0) return;
      useRestore.setState({ offer: restorableTabs });
      if (mode === "always") useRestore.getState().openOffer();
    })
    .catch(notifyError);
}

function saveTabs(tabs: SavedTab[]): void {
  void ipc
    .tabsSave(tabs)
    .then(() => {
      notified = false;
    })
    .catch((error) => {
      if (notified) return;
      notified = true;
      notifyError(error);
    });
}

export function useRestoreTabs(): void {
  // Wait for both: restoring needs the connections to resolve each tab, and the setting to choose the mode.
  const connectionsReady = useConnections((state) => state.status === "ready");
  const settingsLoaded = useSettings((state) => state.settings !== null);

  useEffect(() => {
    if (!connectionsReady || !settingsLoaded) return undefined;
    if (!loadStarted) {
      loadStarted = true;
      loadAndRestore();
    }

    let previous: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: SavedTab[] | null = null;

    // Save the saved set whenever the tabs change (open, close, reorder), at most once per 500 ms, and never
    // before the load: otherwise the empty startup list would overwrite the last run's set.
    const unsubscribe = useSessions.subscribe((state) => {
      if (!loaded) return;
      const current = savedTabsOf(state.sessions);
      const key = current.map((tab) => `${tab.connectionId}:${tab.kind}`).join("\u0000");
      if (key === previous) return;
      previous = key;
      pending = current;
      clearTimeout(timer);
      timer = setTimeout(() => {
        pending = null;
        saveTabs(current);
      }, SAVE_DEBOUNCE_MS);
    });

    return () => {
      // A change still waiting is written now rather than lost.
      clearTimeout(timer);
      if (pending) saveTabs(pending);
      unsubscribe();
    };
  }, [connectionsReady, settingsLoaded]);
}
