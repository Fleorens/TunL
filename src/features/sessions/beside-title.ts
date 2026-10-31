// Title of a tab opened beside another on the same target (kept apart from the store to avoid an import cycle).
import type { SessionTarget } from "@/bindings/SessionTarget";
import { useConnections } from "@/features/connections/store";
import { quickTitle, type Session } from "./session-model";

/**
 * The title of a tab opened beside another on the same target: the saved connection's current name, or the quick
 * target's command line (`uniqueTitle` then adds " (2)"). A connection deleted meanwhile keeps the source tab's title.
 */
export function besideTitle(session: Session): string {
  const target: SessionTarget = session.target;
  if (target.type === "quick") return quickTitle(target);
  const connection = useConnections
    .getState()
    .connections.find((c) => c.id === target.connectionId);
  return connection?.name ?? session.title;
}
