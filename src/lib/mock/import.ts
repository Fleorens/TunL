// Mock handlers for the `~/.ssh/config` import commands. The preview is fixed (docs/…), and the
// apply handler mirrors `apply_import`: bastions first, cycles broken, error candidates never created.

import type { Connection } from "@/bindings/Connection";
import type { ImportCandidate } from "@/bindings/ImportCandidate";
import type { ImportPreview } from "@/bindings/ImportPreview";
import type { Handler } from "./data";
import { arg, MOCK_IDS } from "./data";

const PREVIEW_PATH = "~/.ssh/config";
const now = Date.now();

/** The five canned hosts, in the order the UI sees them. `broken` fails validation, so it is never imported. */
const IMPORT_CANDIDATES: readonly ImportCandidate[] = [
  {
    alias: "staging",
    host: "10.2.0.10",
    port: 22,
    username: "deploy",
    keyPath: "~/.ssh/id_ed25519",
    jump: { type: "candidate", alias: "jump-box" },
    duplicateOf: null,
    warnings: [],
    error: null,
  },
  {
    alias: "jump-box",
    host: "203.0.113.7",
    port: 2222,
    username: "ops",
    keyPath: null,
    jump: null,
    duplicateOf: null,
    warnings: [],
    error: null,
  },
  {
    alias: "web-01",
    host: "10.0.0.12",
    port: 22,
    username: "deploy",
    keyPath: null,
    jump: null,
    duplicateOf: MOCK_IDS.web01,
    warnings: [],
    error: null,
  },
  {
    alias: "legacy",
    host: "legacy.internal",
    port: 22,
    username: "root",
    keyPath: null,
    jump: null,
    duplicateOf: null,
    warnings: ["ProxyCommand is ignored"],
    error: null,
  },
  {
    alias: "broken",
    host: "under_score!",
    port: 22,
    username: null,
    keyPath: null,
    jump: null,
    duplicateOf: null,
    warnings: [],
    error: "host: must be a valid IPv4, IPv6 address or host name",
  },
];

function sshSettings(keyPath: string | null): Connection["settings"] {
  return {
    protocol: "ssh",
    auth: keyPath ? { method: "key", path: keyPath } : { method: "agent" },
    keepaliveSecs: null,
    connectTimeoutSecs: null,
  };
}

function buildConnection(
  candidate: ImportCandidate,
  id: string,
  groupId: string | null,
  jumpHostId: string | null,
): Connection {
  return {
    id,
    name: candidate.alias,
    host: candidate.host,
    port: candidate.port,
    username: candidate.username,
    groupId,
    tags: [],
    favorite: false,
    color: null,
    notes: null,
    jumpHostId,
    wol: null,
    settings: sshSettings(candidate.keyPath),
    createdAt: now,
    updatedAt: now,
    lastConnectedAt: null,
  };
}

export const importHandlers: Record<string, Handler<Record<string, unknown>>> = {
  import_ssh_config_preview(_state, _args) {
    const preview: ImportPreview = {
      path: PREVIEW_PATH,
      candidates: [...IMPORT_CANDIDATES],
      warnings: [],
    };
    return { state: _state, result: preview };
  },

  import_ssh_config_apply(state, args) {
    const { aliases, groupId } = arg<{ aliases: string[]; groupId: string | null }>(args);
    const selected = new Set(aliases);

    // Only selected, error-free candidates are created (mirrors apply_import).
    const importable = IMPORT_CANDIDATES.filter(
      (candidate) => selected.has(candidate.alias) && candidate.error == null,
    );
    const byAlias = new Map(IMPORT_CANDIDATES.map((candidate) => [candidate.alias, candidate]));
    const isImportable = (alias: string) => {
      const candidate = byAlias.get(alias);
      return candidate != null && candidate.error == null;
    };

    const connections = [...state.connections];
    const aliasId = new Map<string, string>();
    const bastionFor = (candidate: ImportCandidate): string | null | "pending" => {
      const jump = candidate.jump;
      if (jump == null || jump.type === "unresolved") return null;
      if (jump.type === "existing") return jump.id;
      // Candidate: only linked when the hop is itself selected and importable.
      if (selected.has(jump.alias) && isImportable(jump.alias)) {
        const id = aliasId.get(jump.alias);
        return id != null ? id : "pending";
      }
      return null;
    };

    let pending: ImportCandidate[] = [...importable];

    while (pending.length > 0) {
      let madeProgress = false;
      const stillPending: ImportCandidate[] = [];

      for (const candidate of pending) {
        const jump = bastionFor(candidate);
        if (jump === "pending") {
          stillPending.push(candidate);
          continue;
        }
        const connection = buildConnection(candidate, crypto.randomUUID(), groupId, jump);
        connections.push(connection);
        aliasId.set(candidate.alias, connection.id);
        madeProgress = true;
      }
      pending = stillPending;
      if (pending.length === 0) break;
      if (madeProgress) continue;

      // A cycle: drop the closing edge of the first pending node (its candidate hop is abandoned).
      const candidate = pending[0];
      pending = pending.slice(1);
      const jump = candidate.jump;
      const jumpHostId = jump != null && jump.type === "existing" ? jump.id : null;
      const connection = buildConnection(candidate, crypto.randomUUID(), groupId, jumpHostId);
      connections.push(connection);
      aliasId.set(candidate.alias, connection.id);
    }

    return {
      state: { ...state, connections },
      result: { groups: state.groups, connections, quarantined: state.quarantined },
    };
  },
};
