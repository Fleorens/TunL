import type { Connection } from "@/bindings/Connection";
import { compareNames } from "./sections";

/** The maximum number of bastions a chain may hold (docs/05-modele-donnees.md §6). */
export const MAX_JUMP_HOSTS = 4;

/**
 * The bastion chain of `jumpHostId`, from the user's side: the outermost bastion first, `jumpHostId` last.
 * Stops on a loop (a host already visited) or a missing link (a jump host that no longer exists).
 */
export function jumpChainNames(connections: readonly Connection[], jumpHostId: string): string[] {
  if (jumpHostId === "") return [];
  const byId = new Map(connections.map((connection) => [connection.id, connection]));
  const names: string[] = [];
  const seen = new Set<string>();
  let currentId: string | null = jumpHostId;
  while (currentId !== null) {
    if (seen.has(currentId)) break; // A loop: stop before repeating a host.
    seen.add(currentId);
    const connection = byId.get(currentId);
    if (connection === undefined) break; // A missing link: the jump host no longer exists.
    names.push(connection.name);
    currentId = connection.jumpHostId;
  }
  return names.reverse();
}

/**
 * SSH connections that can serve as the jump host of `selfId` (null for a new connection): never itself, never an
 * RDP connection, never one whose own chain already goes through `selfId` (that would make a cycle), and never one
 * whose chain is already at `MAX_JUMP_HOSTS` (adding it would exceed the limit). Sorted with `compareNames`.
 */
export function eligibleJumpHosts(
  connections: readonly Connection[],
  selfId: string | null,
): Connection[] {
  return connections
    .filter((connection) => connection.settings.protocol === "ssh")
    .filter((connection) => connection.id !== selfId)
    .filter((connection) => {
      const chain = jumpChainNames(connections, connection.id);
      if (chain.length > MAX_JUMP_HOSTS) return false;
      return selfId === null || !chain.includes(selfId);
    })
    .toSorted((a, b) => compareNames(a.name, b.name));
}
