// The single entry point to open a session from anywhere (sidebar double-click, home card, palette).
// SFTP opens a real explorer tab; a saved RDP connection opens an RDP tab (T28b); everything else opens a real SSH tab.
import type { Connection } from "@/bindings/Connection";
import type { QuickTarget } from "@/features/palette/quick-connect";
import { quickTitle, type Session } from "./session-model";
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

/**
 * Opening an SSH address typed on the fly: a real tab titled like the command line. Only SSH targets come here: an RDP
 * tab opens only on a saved connection, so an RDP address opens the editor filled in instead.
 */
export function openQuickSession(target: QuickTarget): void {
  useSessions
    .getState()
    .open(
      { type: "quick", host: target.host, port: target.port, username: target.username },
      quickTitle(target),
    );
}

/**
 * Open an SFTP tab on an already-open SSH tab's target, titled after it (so it becomes "… (2)"). Used from a
 * tab's right-click menu and from the palette for the active terminal tab.
 */
export function openSftpFrom(session: Session): void {
  useSessions.getState().open(session.target, session.title, "sftp");
}
