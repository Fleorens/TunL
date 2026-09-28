import type { Connection } from "@/bindings/Connection";
import type { QuickTarget } from "@/features/palette/quick-connect";
import { notifyComingSoon } from "@/features/shell/coming-soon";

/** What opening a session shows: a shell, or an SFTP explorer. Until T21, both are placeholders. */
export type SessionKind = "terminal" | "sftp";

/** Single entry point to open a saved connection. Until T21: `notifyComingSoon()`. */
export function openSession(connection: Connection, kind?: SessionKind): void {
  void connection;
  void kind;
  notifyComingSoon();
}

/** Same for an address typed on the fly. Until T21: `notifyComingSoon()`. */
export function openQuickSession(target: QuickTarget): void {
  void target;
  notifyComingSoon();
}
