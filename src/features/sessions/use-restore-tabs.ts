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

export function useRestoreTabs(): void {
  // Wait for both: restoring needs the connections to resolve each tab, and the setting to choose the mode.
  const connectionsReady = useConnections((state) => state.status === "ready");
  const settingsLoaded = useSettings((state) => state.settings !== null);

  useEffect(() => {
    if (!connectionsReady || !settingsLoaded) return undefined;

    let loaded = false;
    let previous: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let notified = false;

    const scheduleSave = (tabs: SavedTab[]): void => {
      // One error toast per burst: reset the flag on every new save, so a persist failure is not repeated.
      clearTimeout(timer);
      notified = false;
      timer = setTimeout(() => {
        void ipc.tabsSave(tabs).catch((error) => {
          if (!notified) {
            notified = true;
            notifyError(error);
          }
        });
      }, SAVE_DEBOUNCE_MS);
    };

    // Load the saved set once, then restore it per the setting.
    void ipc
      .tabsLoad()
      .then((saved) => {
        loaded = true;
        const restorableTabs = restorable(saved, useConnections.getState().connections);
        const mode = useSettings.getState().settings?.ui.restoreTabs ?? "ask";
        if (mode === "always") {
          // Open them in order, the first becoming active, then hide the (nonexistent) offer.
          useRestore.setState({ offer: restorableTabs });
          useRestore.getState().openOffer();
        } else if (mode === "ask" && restorableTabs.length > 0) {
          useRestore.setState({ offer: restorableTabs });
        }
      })
      .catch(notifyError);

    // Save the saved set whenever the tabs change (open, close, reorder), at most once per 500 ms, and never
    // before the load: otherwise the empty startup list would overwrite the last run's set.
    const unsubscribe = useSessions.subscribe((state) => {
      if (!loaded) return;
      const current = savedTabsOf(state.sessions);
      const key = current.map((tab) => `${tab.connectionId}:${tab.kind}`).join("\u0000");
      if (key === previous) return;
      previous = key;
      scheduleSave(current);
    });

    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [connectionsReady, settingsLoaded]);
}
