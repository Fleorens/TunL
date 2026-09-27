import type { Connection } from "@/bindings/Connection";
import type { Group } from "@/bindings/Group";

/** The maximum number of recents shown in the sidebar. */
export const RECENTS_LIMIT = 5;

export interface SidebarSections {
  favorites: Connection[];
  /** Sorted by `lastConnectedAt` descending, `RECENTS_LIMIT` at most. */
  recents: Connection[];
  /** In store order, empty groups included. */
  groups: { group: Group; connections: Connection[] }[];
  /** `groupId` is null or unknown. */
  ungrouped: Connection[];
}

/** Natural, case-insensitive comparison: "Web-1" < "web-2" < "web-10". */
export function compareNames(a: string, b: string): number {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return collator.compare(a, b);
}

/**
 * Builds the sidebar sections from the raw store data.
 *
 * - `favorites`: favorites, sorted by name;
 * - `recents`: the most recent connections, sorted by `lastConnectedAt` descending;
 * - `groups`: in store order, empty groups included, connections sorted by name;
 * - `ungrouped`: connections with a null or unknown groupId.
 *
 * Inputs are never mutated.
 */
export function buildSidebarSections(
  connections: readonly Connection[],
  groups: readonly Group[],
): SidebarSections {
  const groupById = new Map(groups.map((group) => [group.id, true]));

  const favorites = [...connections]
    .filter((connection) => connection.favorite)
    .toSorted((a, b) => compareNames(a.name, b.name));

  const recents = [...connections]
    .filter((connection) => connection.lastConnectedAt !== null)
    .toSorted((a, b) => (b.lastConnectedAt ?? 0) - (a.lastConnectedAt ?? 0))
    .slice(0, RECENTS_LIMIT);

  const byGroup = new Map<string, Connection[]>();
  const ungrouped: Connection[] = [];
  for (const connection of connections) {
    const groupId = connection.groupId;
    if (groupId !== null && groupById.has(groupId)) {
      const bucket = byGroup.get(groupId) ?? [];
      bucket.push(connection);
      byGroup.set(groupId, bucket);
    } else {
      ungrouped.push(connection);
    }
  }

  return {
    favorites,
    recents,
    groups: groups.map((group) => ({
      group,
      connections: (byGroup.get(group.id) ?? []).toSorted((a, b) => compareNames(a.name, b.name)),
    })),
    ungrouped: ungrouped.toSorted((a, b) => compareNames(a.name, b.name)),
  };
}
