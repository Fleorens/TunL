// T60: which tabs are worth saving, and which of them can open again. Pure, so the store can derive the
// ones to save from the row, and the home screen can derive the ones worth offering, without a backend.
import type { Connection } from "@/bindings/Connection";
import type { SavedTab } from "@/bindings/SavedTab";
import type { Session } from "./session-model";

/**
 * The tabs worth saving, in the row's order: saved connections only (a quick target is never kept).
 * A saved tab is a connection id and what the tab ran (a shell, a file explorer, or a desktop).
 */
export function savedTabsOf(sessions: readonly Session[]): SavedTab[] {
  const tabs: SavedTab[] = [];
  for (const session of sessions) {
    if (session.connectionId === null) continue;
    tabs.push({ connectionId: session.connectionId, kind: session.kind });
  }
  return tabs;
}

/**
 * The saved tabs that can still open: their connection exists, and an RDP tab only on an RDP connection
 * (an SSH or SFTP tab only on an SSH one). Order kept.
 */
export function restorable(
  saved: readonly SavedTab[],
  connections: readonly Connection[],
): SavedTab[] {
  return saved.filter((savedTab) => {
    const connection = connections.find((candidate) => candidate.id === savedTab.connectionId);
    if (!connection) return false;
    const protocol = connection.settings.protocol;
    return savedTab.kind === "rdp" ? protocol === "rdp" : protocol === "ssh";
  });
}
