// Initial state of the mock backend: the three demo groups, the eleven demo connections,
// the default settings and the form templates. Replaced (never mutated) on every mutation;
// `freshState()` hands out a clean copy for `resetMockBackend()` and the first load.
import type { Connection } from "@/bindings/Connection";
import type { ConnectionTemplates } from "@/bindings/ConnectionTemplates";
import type { Group } from "@/bindings/Group";
import type { ProtocolSettings } from "@/bindings/ProtocolSettings";
import type { Settings } from "@/bindings/Settings";
import type { SshAuth } from "@/bindings/SshAuth";
import type { WolConfig } from "@/bindings/WolConfig";

/** Fixed, readable UUIDs for the demo data (the property names are the readable part). */
export const MOCK_IDS = {
  production: "a1000000-0000-4000-8000-000000000001",
  clients: "a1000000-0000-4000-8000-000000000002",
  homelab: "a1000000-0000-4000-8000-000000000003",
  web01: "a1000000-0000-4000-8000-000000000101",
  web02: "a1000000-0000-4000-8000-000000000102",
  dbProd: "a1000000-0000-4000-8000-000000000103",
  bastion01: "a1000000-0000-4000-8000-000000000104",
  ad01: "a1000000-0000-4000-8000-000000000105",
  nas: "a1000000-0000-4000-8000-000000000106",
  piHole: "a1000000-0000-4000-8000-000000000107",
  mediaServer: "a1000000-0000-4000-8000-000000000108",
  winDesktop: "a1000000-0000-4000-8000-000000000109",
  router: "a1000000-0000-4000-8000-00000000010a",
  kiosk01: "a1000000-0000-4000-8000-00000000010b",
} as const;

const now = Date.now();
const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;
const creationTime = now - 30 * day;

type GroupKey = keyof typeof MOCK_IDS;

interface DemoSpec {
  id: GroupKey;
  name: string;
  protocol: "ssh" | "rdp";
  host: string;
  port: number;
  username: string | null;
  group: GroupKey | null;
  tags: readonly string[];
  favorite: boolean;
  jumpHost: GroupKey | null;
  lastConnectedAt: number | null;
  sshAuth: "agent" | "key";
  wol: WolConfig | null;
}

const SSH_KEY_PATH = "~/.ssh/id_ed25519";

function sshAuth(auth: "agent" | "key" | "password"): SshAuth {
  if (auth === "key") return { method: "key", path: SSH_KEY_PATH };
  if (auth === "password") return { method: "password" };
  return { method: "agent" };
}

function sshSettings(auth: "agent" | "key" | "password"): ProtocolSettings {
  return {
    protocol: "ssh",
    auth: sshAuth(auth),
    keepaliveSecs: null,
    connectTimeoutSecs: null,
  };
}

function rdpSettings(): ProtocolSettings {
  return {
    protocol: "rdp",
    domain: null,
    display: { mode: "fit" },
    multimon: false,
    dynamicResolution: true,
    clipboard: true,
    audio: "local",
    shareHome: false,
    certPolicy: "prompt",
    extraArgs: [],
  };
}

function buildConnection(spec: DemoSpec): Connection {
  return {
    id: MOCK_IDS[spec.id],
    name: spec.name,
    host: spec.host,
    port: spec.port,
    username: spec.username,
    groupId: spec.group ? MOCK_IDS[spec.group] : null,
    tags: [...spec.tags],
    favorite: spec.favorite,
    color: null,
    notes: null,
    jumpHostId: spec.jumpHost ? MOCK_IDS[spec.jumpHost] : null,
    wol: spec.wol,
    settings: spec.protocol === "ssh" ? sshSettings(spec.sshAuth) : rdpSettings(),
    createdAt: creationTime,
    updatedAt: spec.lastConnectedAt ?? creationTime,
    lastConnectedAt: spec.lastConnectedAt,
  };
}

export const MOCK_CONNECTION_SPECS: readonly DemoSpec[] = [
  {
    id: "web01",
    name: "web-01",
    protocol: "ssh",
    host: "10.0.0.12",
    port: 22,
    username: "deploy",
    group: "production",
    tags: ["prod", "web"],
    favorite: true,
    jumpHost: "bastion01",
    lastConnectedAt: now - 5 * minute,
    sshAuth: "agent",
    wol: null,
  },
  {
    id: "web02",
    name: "web-02",
    protocol: "ssh",
    host: "10.0.0.13",
    port: 22,
    username: "deploy",
    group: "production",
    tags: ["prod", "web"],
    favorite: false,
    jumpHost: "bastion01",
    lastConnectedAt: null,
    sshAuth: "agent",
    wol: null,
  },
  {
    id: "dbProd",
    name: "db-prod",
    protocol: "ssh",
    host: "db.internal",
    port: 22,
    username: "root",
    group: "production",
    tags: ["prod", "pg"],
    favorite: false,
    jumpHost: "bastion01",
    lastConnectedAt: now - hour,
    sshAuth: "key",
    wol: null,
  },
  {
    id: "bastion01",
    name: "bastion-01",
    protocol: "ssh",
    host: "bastion.example.net",
    port: 2222,
    username: "ops",
    group: "production",
    tags: ["bastion"],
    favorite: false,
    jumpHost: null,
    lastConnectedAt: now - hour,
    sshAuth: "agent",
    wol: null,
  },
  {
    id: "ad01",
    name: "ad-01",
    protocol: "rdp",
    host: "10.0.0.5",
    port: 3389,
    username: "admin",
    group: "clients",
    tags: ["windows"],
    favorite: true,
    jumpHost: null,
    lastConnectedAt: now - day,
    sshAuth: "agent",
    wol: null,
  },
  {
    id: "nas",
    name: "nas",
    protocol: "ssh",
    host: "192.168.1.10",
    port: 22,
    username: "admin",
    group: "homelab",
    tags: ["storage"],
    favorite: false,
    jumpHost: null,
    lastConnectedAt: now - 3 * day,
    sshAuth: "agent",
    wol: null,
  },
  {
    id: "piHole",
    name: "pi-hole",
    protocol: "ssh",
    host: "192.168.1.2",
    port: 22,
    username: "pi",
    group: "homelab",
    tags: ["dns"],
    favorite: false,
    jumpHost: null,
    lastConnectedAt: null,
    sshAuth: "agent",
    wol: null,
  },
  {
    id: "mediaServer",
    name: "media-server",
    protocol: "ssh",
    host: "192.168.1.20",
    port: 22,
    username: "media",
    group: "homelab",
    tags: [],
    favorite: false,
    jumpHost: null,
    lastConnectedAt: null,
    sshAuth: "agent",
    wol: null,
  },
  {
    id: "winDesktop",
    name: "win-desktop",
    protocol: "rdp",
    host: "192.168.1.50",
    port: 3389,
    username: "ops",
    group: "homelab",
    tags: ["wol"],
    favorite: false,
    jumpHost: null,
    lastConnectedAt: null,
    sshAuth: "agent",
    wol: {
      mac: "52:54:00:12:34:56",
      broadcast: "192.168.1.255",
      port: 9,
      wakeBeforeConnect: true,
      waitTimeoutSecs: 120,
    },
  },
  {
    id: "router",
    name: "router",
    protocol: "ssh",
    host: "192.168.1.1",
    port: 22,
    username: "root",
    group: null,
    tags: ["network"],
    favorite: false,
    jumpHost: null,
    lastConnectedAt: null,
    sshAuth: "agent",
    wol: null,
  },
  {
    id: "kiosk01",
    name: "kiosk-01",
    protocol: "ssh",
    host: "172.16.0.40",
    port: 22,
    username: null,
    group: null,
    tags: [],
    favorite: false,
    jumpHost: null,
    lastConnectedAt: null,
    sshAuth: "agent",
    wol: null,
  },
];

export const MOCK_GROUPS: readonly Group[] = [
  { id: MOCK_IDS.production, name: "Production", color: "blue" },
  { id: MOCK_IDS.clients, name: "Clients", color: "violet" },
  { id: MOCK_IDS.homelab, name: "Homelab", color: "green" },
];

export const MOCK_CONNECTIONS: readonly Connection[] = MOCK_CONNECTION_SPECS.map(buildConnection);

/** The whole `settings.json` document, at its defaults. `theme` is `"system"` (see note in settings.ts). */
export const MOCK_SETTINGS: Settings = {
  version: 1,
  language: "system",
  theme: "system",
  reduceMotion: "system",
  terminal: {
    theme: "auto",
    fontFamily: "Geist Mono Variable",
    fontSize: 13,
    lineHeight: 1.25,
    cursorStyle: "bar",
    cursorBlink: true,
    scrollback: 10_000,
    copyOnSelect: false,
    bell: false,
  },
  ssh: { connectTimeoutSecs: 15, keepaliveSecs: 30 },
  rdp: { clientPath: null },
  reachability: { enabled: true, intervalSecs: 300 },
  ui: {
    sidebarWidth: 272,
    sidebarCollapsed: false,
    confirmCloseActiveSession: true,
    downloadDir: null,
    titleBar: "native",
    restoreTabs: "ask",
  },
};

/** The form defaults: SSH and RDP inputs plus the Wake-on-LAN example. */
export const TEMPLATES: ConnectionTemplates = {
  ssh: {
    name: "",
    host: "",
    port: 22,
    username: null,
    groupId: null,
    tags: [],
    favorite: false,
    color: null,
    notes: null,
    jumpHostId: null,
    wol: null,
    settings: sshSettings("password"),
  },
  rdp: {
    name: "",
    host: "",
    port: 3389,
    username: null,
    groupId: null,
    tags: [],
    favorite: false,
    color: null,
    notes: null,
    jumpHostId: null,
    wol: null,
    settings: rdpSettings(),
  },
  wol: {
    mac: "",
    broadcast: "255.255.255.255",
    port: 9,
    wakeBeforeConnect: false,
    waitTimeoutSecs: 120,
  },
};

/** The mock's whole in-memory state. Every mutation builds a new value and replaces it here. */
export interface MockState {
  groups: Group[];
  connections: Connection[];
  settings: Settings;
  quarantined: string[];
  /** `"<connectionId>:<kind>"` for every stored secret. Never the value itself (S1). */
  secrets: string[];
}

/** A pristine copy of the demo data, for the first load and for `resetMockBackend()`. */
export function freshState(): MockState {
  return structuredClone({
    groups: [...MOCK_GROUPS],
    connections: [...MOCK_CONNECTIONS],
    settings: MOCK_SETTINGS,
    quarantined: [],
    secrets: [`${MOCK_IDS.ad01}:password`, `${MOCK_IDS.dbProd}:passphrase`],
  });
}

/**
 * One mock command: read the current state, return a new state (replaced, never mutated) and the result.
 * Throws an `AppError`-shaped value on failure, exactly like a backend command.
 */
export type Handler<A = Record<string, unknown>> = (
  state: MockState,
  args: A,
) => { state: MockState; result: unknown };

/**
 * Read the raw IPC args as a typed object. The mock receives serialized args (`Record<string, unknown>`),
 * so this is the single, honest cast at the backend boundary.
 */
export function arg<A>(args: Record<string, unknown>): A {
  return args as A;
}
