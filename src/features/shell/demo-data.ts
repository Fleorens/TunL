// DEMO DATA — temporary. Replaced by real stores in T21 (sessions).
import { create } from "zustand";
import type { Status } from "@/components/StatusDot";
import { MOCK_IDS } from "@/lib/mock/data";

export interface DemoTab {
  id: string;
  connectionId: string;
  title: string;
  protocol: "ssh" | "rdp";
  status: Status;
}

interface DemoTabsState {
  tabs: readonly DemoTab[];
  activeId: string | null;
  activate: (id: string) => void;
  activateIndex: (index: number) => void;
  activateRelative: (delta: 1 | -1) => void;
  close: (id: string) => void;
}

// These ids exist only in the mock backend; in Tauri they are absent until T21,
// so the status bar shows no address for them. That is expected.
export const INITIAL_TABS: readonly DemoTab[] = [
  { id: "t1", connectionId: MOCK_IDS.web01, title: "web-01", protocol: "ssh", status: "online" },
  {
    id: "t2",
    connectionId: MOCK_IDS.dbProd,
    title: "db-prod",
    protocol: "ssh",
    status: "connecting",
  },
];

export const useDemoTabs = create<DemoTabsState>()((set) => ({
  tabs: INITIAL_TABS,
  activeId: "t1",
  activate: (id) => set({ activeId: id }),
  activateIndex: (index) =>
    set((state) => {
      const target = state.tabs[Math.min(index, state.tabs.length - 1)];
      return target ? { activeId: target.id } : {};
    }),
  activateRelative: (delta) =>
    set((state) => {
      if (state.tabs.length === 0) return {};
      const current = state.tabs.findIndex((tab) => tab.id === state.activeId);
      const next = (current + delta + state.tabs.length) % state.tabs.length;
      return { activeId: state.tabs[next].id };
    }),
  close: (id) =>
    set((state) => {
      const index = state.tabs.findIndex((tab) => tab.id === id);
      const tabs = state.tabs.filter((tab) => tab.id !== id);
      if (state.activeId !== id) return { tabs };
      const neighbour = tabs[Math.min(index, tabs.length - 1)];
      return { tabs, activeId: neighbour ? neighbour.id : null };
    }),
}));
