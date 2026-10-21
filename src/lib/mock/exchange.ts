// Mock handlers for the export/import commands (T32). The export counts every connection; the import
// "reads" a fixed file and fuses it into the state, exactly like `plan_import` (docs/05 §5).

import type { AccentColor } from "@/bindings/AccentColor";
import type { Connection } from "@/bindings/Connection";
import type { ImportReport } from "@/bindings/ImportReport";
import type { Handler, MockState } from "./data";
import { TEMPLATES } from "./data";

/** The fixed id of the group the import file brings, created if the store has no "Backups". */
export const MOCK_IMPORTED_GROUP = "a1000000-0000-4000-8000-000000000901";

/** The group the fixed import file brings, in every row. */
const IMPORT_GROUP_NAME = "Backups";
const IMPORT_GROUP_COLOR: AccentColor = "amber";

/** The identity of each connection the mock "reads", in the order the file lists them. */
const IMPORT_FILE: readonly {
  name: string;
  host: string;
  port: number;
  username: string | null;
}[] = [
  // Already in the demo (same protocol, host, port, username): skipped on import.
  { name: "nas", host: "192.168.1.10", port: 22, username: "admin" },
  // New (192.168.1.30): added, in the new "Backups" group.
  { name: "backup-01", host: "192.168.1.30", port: 22, username: "backup" },
];

/** The dedup key: protocol, host (lowercase), port, username — the same four fields as `to_input`. */
function connectionKey(connection: Connection): string {
  const protocol = connection.settings.protocol;
  const host = connection.host.toLowerCase();
  const username = connection.username ?? "";
  return `${protocol}|${host}|${connection.port}|${username}`;
}

export const exchangeHandlers: Record<string, Handler<MockState>> = {
  store_export(state) {
    // The export counts every connection in the store.
    return { state, result: state.connections.length };
  },

  store_import(state) {
    const groups = [...state.groups];
    const connections = [...state.connections];
    const report: ImportReport = { added: 0, skipped: 0, invalid: 0, groupsCreated: 0 };

    // Match a group by name (case-insensitive, trimmed); create it if it is new.
    const groupIdFor = () => {
      const key = IMPORT_GROUP_NAME.trim().toLowerCase();
      const existing = groups.find((candidate) => candidate.name.trim().toLowerCase() === key);
      if (existing) return existing.id;
      const created = {
        id: MOCK_IMPORTED_GROUP,
        name: IMPORT_GROUP_NAME,
        color: IMPORT_GROUP_COLOR,
      };
      groups.push(created);
      report.groupsCreated += 1;
      return created.id;
    };
    const groupId = groupIdFor();

    // Skip a connection already in the store; add the rest, seeded from the SSH template.
    for (const incoming of IMPORT_FILE) {
      const candidate: Connection = {
        ...TEMPLATES.ssh,
        id: crypto.randomUUID(),
        name: incoming.name,
        host: incoming.host,
        port: incoming.port,
        username: incoming.username,
        groupId,
        tags: [],
        createdAt: 0,
        updatedAt: 0,
        lastConnectedAt: null,
      };
      if (
        connections.some((connection) => connectionKey(connection) === connectionKey(candidate))
      ) {
        report.skipped += 1;
        continue;
      }
      const nowMs = Date.now();
      candidate.createdAt = nowMs;
      candidate.updatedAt = nowMs;
      connections.push(candidate);
      report.added += 1;
    }

    return { state: { ...state, groups, connections }, result: report };
  },
};
