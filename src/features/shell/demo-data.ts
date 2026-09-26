// DEMO DATA — temporary. Replaced by real stores in T09 (connections) and T21 (sessions).
import { create } from "zustand";
import type { Status } from "@/components/StatusDot";
import type { AccentColor } from "@/lib/colors";

export interface DemoGroup {
  id: string;
  name: string;
  color: AccentColor;
}

export interface DemoConnection {
  id: string;
  name: string;
  protocol: "ssh" | "rdp";
  host: string;
  port: number;
  username: string | null;
  groupId: string | null;
  tags: string[];
  favorite: boolean;
  jumpHostName: string | null;
  status: Status;
  lastConnectedAt: number | null;
}

export interface DemoTab {
  id: string;
  connectionId: string;
  title: string;
  protocol: "ssh" | "rdp";
  status: Status;
}

const now = Date.now();
const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

export const DEMO_GROUPS: readonly DemoGroup[] = [
  { id: "g-production", name: "Production", color: "blue" },
  { id: "g-clients", name: "Clients", color: "violet" },
  { id: "g-homelab", name: "Homelab", color: "green" },
];

export const DEMO_CONNECTIONS: readonly DemoConnection[] = [
  {
    id: "c-web-01",
    name: "web-01",
    protocol: "ssh",
    host: "10.0.0.12",
    port: 22,
    username: "deploy",
    groupId: "g-production",
    tags: ["prod", "web"],
    favorite: true,
    jumpHostName: "bastion-01",
    status: "online",
    lastConnectedAt: now - 5 * minute,
  },
  {
    id: "c-web-02",
    name: "web-02",
    protocol: "ssh",
    host: "10.0.0.13",
    port: 22,
    username: "deploy",
    groupId: "g-production",
    tags: ["prod", "web"],
    favorite: false,
    jumpHostName: "bastion-01",
    status: "online",
    lastConnectedAt: null,
  },
  {
    id: "c-db-prod",
    name: "db-prod",
    protocol: "ssh",
    host: "db.internal",
    port: 22,
    username: "root",
    groupId: "g-production",
    tags: ["prod", "pg"],
    favorite: false,
    jumpHostName: "bastion-01",
    status: "connecting",
    lastConnectedAt: now - hour,
  },
  {
    id: "c-bastion-01",
    name: "bastion-01",
    protocol: "ssh",
    host: "bastion.example.net",
    port: 2222,
    username: "ops",
    groupId: "g-production",
    tags: ["bastion"],
    favorite: false,
    jumpHostName: null,
    status: "online",
    lastConnectedAt: now - hour,
  },
  {
    id: "c-ad-01",
    name: "ad-01",
    protocol: "rdp",
    host: "10.0.0.5",
    port: 3389,
    username: "admin",
    groupId: "g-clients",
    tags: ["windows"],
    favorite: true,
    jumpHostName: null,
    status: "online",
    lastConnectedAt: now - day,
  },
  {
    id: "c-nas",
    name: "nas",
    protocol: "ssh",
    host: "192.168.1.10",
    port: 22,
    username: "admin",
    groupId: "g-homelab",
    tags: ["storage"],
    favorite: false,
    jumpHostName: null,
    status: "offline",
    lastConnectedAt: now - 3 * day,
  },
  {
    id: "c-pi-hole",
    name: "pi-hole",
    protocol: "ssh",
    host: "192.168.1.2",
    port: 22,
    username: "pi",
    groupId: "g-homelab",
    tags: ["dns"],
    favorite: false,
    jumpHostName: null,
    status: "online",
    lastConnectedAt: null,
  },
  {
    id: "c-media-server",
    name: "media-server",
    protocol: "ssh",
    host: "192.168.1.20",
    port: 22,
    username: "media",
    groupId: "g-homelab",
    tags: [],
    favorite: false,
    jumpHostName: null,
    status: "unknown",
    lastConnectedAt: null,
  },
  {
    id: "c-win-desktop",
    name: "win-desktop",
    protocol: "rdp",
    host: "192.168.1.50",
    port: 3389,
    username: "ops",
    groupId: "g-homelab",
    tags: ["wol"],
    favorite: false,
    jumpHostName: null,
    status: "offline",
    lastConnectedAt: null,
  },
  {
    id: "c-router",
    name: "router",
    protocol: "ssh",
    host: "192.168.1.1",
    port: 22,
    username: "root",
    groupId: null,
    tags: ["network"],
    favorite: false,
    jumpHostName: null,
    status: "online",
    lastConnectedAt: null,
  },
  {
    id: "c-kiosk-01",
    name: "kiosk-01",
    protocol: "ssh",
    host: "172.16.0.40",
    port: 22,
    username: null,
    groupId: null,
    tags: [],
    favorite: false,
    jumpHostName: null,
    status: "unknown",
    lastConnectedAt: null,
  },
];

interface DemoTabsState {
  tabs: readonly DemoTab[];
  activeId: string | null;
  activate: (id: string) => void;
  activateIndex: (index: number) => void;
  activateRelative: (delta: 1 | -1) => void;
  close: (id: string) => void;
}

export const INITIAL_TABS: readonly DemoTab[] = [
  { id: "t1", connectionId: "c-web-01", title: "web-01", protocol: "ssh", status: "online" },
  { id: "t2", connectionId: "c-db-prod", title: "db-prod", protocol: "ssh", status: "connecting" },
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
