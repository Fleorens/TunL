import type { Connection } from "@/bindings/Connection";
import type { ConnectionInput } from "@/bindings/ConnectionInput";

/**
 * Everything a stored connection already holds, as a form input for `connection_update`.
 * Used by the sidebar to move a connection into/out of a group without re-entering its settings.
 */
export function toInput(connection: Connection): ConnectionInput {
  return {
    name: connection.name,
    host: connection.host,
    port: connection.port,
    username: connection.username,
    groupId: connection.groupId,
    tags: [...connection.tags],
    favorite: connection.favorite,
    color: connection.color,
    notes: connection.notes,
    jumpHostId: connection.jumpHostId,
    wol: connection.wol,
    settings: connection.settings,
  };
}
