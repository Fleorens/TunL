// The single entry point to open a session from anywhere (sidebar double-click, home card, palette).
// SFTP opens a real explorer tab; a saved RDP connection opens an RDP tab (T28b); everything else opens a real SSH tab.
import type { Connection } from "@/bindings/Connection";
import type { QuickTarget } from "@/features/palette/quick-connect";
import { notifyComingSoon } from "@/features/shell/coming-soon";
import { quickTitle } from "./session-model";
import { useSessions } from "./store";

/** Opening a saved connection: SFTP opens a real explorer tab, RDP opens a real tab, SSH opens a real tab. */
export function openSession(connection: Connection, kind?: "terminal" | "sftp"): void {
  if (kind === "sftp") {
    useSessions
      .getState()
      .open({ type: "saved", connectionId: connection.id }, connection.name, "sftp");
    return;
  }
  if (connection.settings.protocol === "rdp") {
    useSessions
      .getState()
      .open({ type: "saved", connectionId: connection.id }, connection.name, "rdp");
    return;
  }
  useSessions.getState().open({ type: "saved", connectionId: connection.id }, connection.name);
}

/** Opening an address typed on the fly: RDP is not there yet, SSH opens a real tab titled like the command line. */
export function openQuickSession(target: QuickTarget): void {
  if (target.protocol === "rdp") {
    notifyComingSoon();
    return;
  }
  useSessions
    .getState()
    .open(
      { type: "quick", host: target.host, port: target.port, username: target.username },
      quickTitle(target),
    );
}
