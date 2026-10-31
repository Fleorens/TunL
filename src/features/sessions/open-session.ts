// The single entry point to open a session from anywhere (sidebar double-click, home card, palette).
// SFTP opens a real explorer tab; a saved RDP connection opens an RDP tab (T28b); everything else opens a real SSH tab.
import { toast } from "sonner";
import type { Connection } from "@/bindings/Connection";
import type { SessionTarget } from "@/bindings/SessionTarget";
import { useConnections } from "@/features/connections/store";
import type { QuickTarget } from "@/features/palette/quick-connect";
import { i18n } from "@/i18n";
import { quickTitle, type Session } from "./session-model";
import { hasControlChar } from "./shell-quote";
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
 * The title of a tab opened beside another on the same target: the saved connection's current name, or the quick
 * target's command line (`uniqueTitle` then adds " (2)"). A connection deleted meanwhile keeps the source tab's title.
 */
function besideTitle(session: Session): string {
  const target: SessionTarget = session.target;
  if (target.type === "quick") return quickTitle(target);
  const connection = useConnections
    .getState()
    .connections.find((c) => c.id === target.connectionId);
  return connection?.name ?? session.title;
}

/**
 * Open an SFTP tab on an already-open SSH tab's target. Used from a tab's right-click menu and from the palette for
 * the active terminal tab.
 */
export function openSftpFrom(session: Session): void {
  useSessions.getState().open(session.target, besideTitle(session), "sftp");
}

/**
 * Open an SSH tab on an SFTP tab's target, already `cd`-ed into `dir` (the SFTP toolbar's "Open a terminal here").
 * A `dir` with a control character is never typed into the shell: the tab opens in the home folder, with a toast.
 */
export function openTerminalFrom(session: Session, dir: string): void {
  const unsafe = hasControlChar(dir);
  if (unsafe) toast.warning(i18n.t("sftp.openTerminalUnsafe"));
  useSessions
    .getState()
    .open(session.target, besideTitle(session), "ssh", unsafe ? undefined : { dir });
}
