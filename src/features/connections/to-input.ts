import type { Connection } from "@/bindings/Connection";
import type { ConnectionInput } from "@/bindings/ConnectionInput";

/**
 * The editable part of a connection (drops `id` and the timestamps).
 *
 * Written field by field, no rest spread: if a field is added to `ConnectionInput` later,
 * TypeScript flags the omission here.
 */
export function toInput(connection: Connection): ConnectionInput {
  return {
    name: connection.name,
    host: connection.host,
    port: connection.port,
    username: connection.username,
    groupId: connection.groupId,
    tags: connection.tags,
    favorite: connection.favorite,
    color: connection.color,
    notes: connection.notes,
    jumpHostId: connection.jumpHostId,
    wol: connection.wol,
    settings: connection.settings,
  };
}
