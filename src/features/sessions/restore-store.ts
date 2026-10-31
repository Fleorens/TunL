// The "reopen last time's tabs" offer at startup (T60): the restorable tabs from the last run, and the two
// actions that consume it (reopen, in order, or dismiss). The loading, saving and startup wiring live in
// `use-restore-tabs.ts`; this holds only the offer, so HomeView can read it.
import { create } from "zustand";
import type { SavedTab } from "@/bindings/SavedTab";
import { useConnections } from "@/features/connections/store";
import { useSessions } from "./store";

interface RestoreOfferState {
  /** The restorable tabs from the last run, in order, while the offer is shown (empty once gone). */
  offer: readonly SavedTab[];
  /** Open the offered tabs in order (the first becomes active), then hide the offer. */
  openOffer: () => void;
  /** Hide the offer without opening anything. */
  dismissOffer: () => void;
}

/** Open one offered tab on its saved connection: SFTP an explorer tab, otherwise the connection's protocol. */
function openRestoredTab(tab: SavedTab): string | null {
  const connection = useConnections
    .getState()
    .connections.find((candidate) => candidate.id === tab.connectionId);
  if (!connection) return null;
  return useSessions
    .getState()
    .open(
      { type: "saved", connectionId: connection.id },
      connection.name,
      tab.kind === "sftp" ? "sftp" : undefined,
    );
}

export const useRestore = create<RestoreOfferState>()((set, get) => ({
  offer: [],

  openOffer() {
    const offer = get().offer;
    if (offer.length === 0) return;
    // `open` makes each new tab active, so keep the first to make it active at the end.
    let firstId: string | null = null;
    offer.forEach((tab) => {
      const id = openRestoredTab(tab);
      if (firstId === null) firstId = id;
    });
    if (firstId) useSessions.getState().activate(firstId);
    set({ offer: [] });
  },

  dismissOffer() {
    set({ offer: [] });
  },
}));
