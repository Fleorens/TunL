// Mock handlers for the group commands. Each builds a new state and returns it (never mutates).

import type { AccentColor } from "@/bindings/AccentColor";
import type { Connection } from "@/bindings/Connection";
import type { Group } from "@/bindings/Group";
import type { Handler } from "./data";
import { arg } from "./data";

function validation(message: string): { kind: "validation"; message: string; detail: null } {
  return { kind: "validation", message, detail: null };
}

function notFound(what: string): { kind: "notFound"; message: string; detail: null } {
  return { kind: "notFound", message: `${what} not found`, detail: null };
}

/** Trim, and reject a blank name. */
function trimmedName(name: string): string {
  const value = name.trim();
  if (value === "") throw validation("name: must not be empty");
  return value;
}

/** Group names are unique case-insensitively; renaming a group to itself is allowed. */
function uniqueName(name: string, groups: readonly Group[], excludeId: string | null) {
  if (
    groups.some(
      (group) => group.id !== excludeId && group.name.toLowerCase() === name.toLowerCase(),
    )
  ) {
    throw validation("name: must be unique");
  }
}

/** `ids` must contain every current group id exactly once (a full permutation). */
function assertFullPermutation(ids: readonly string[], current: readonly string[]) {
  if (ids.length !== current.length) throw validation("ids: must list every group exactly once");
  const remaining = current.slice();
  for (const id of ids) {
    const index = remaining.indexOf(id);
    if (index === -1) throw validation("ids: must list every group exactly once");
    remaining.splice(index, 1);
  }
}

export const groupHandlers: Record<string, Handler<Record<string, unknown>>> = {
  group_create(_state, args) {
    const { input } = arg<{ input: { name: string; color: AccentColor | null } }>(args);
    const trimmed = trimmedName(input.name);
    uniqueName(trimmed, _state.groups, null);
    const group: Group = { id: crypto.randomUUID(), name: trimmed, color: input.color ?? null };
    return { state: { ..._state, groups: [..._state.groups, group] }, result: group };
  },

  group_update(_state, args) {
    const { id, input } = arg<{ id: string; input: { name: string; color: AccentColor | null } }>(
      args,
    );
    const index = _state.groups.findIndex((group) => group.id === id);
    if (index === -1) throw notFound("group");
    const trimmed = trimmedName(input.name);
    uniqueName(trimmed, _state.groups, id);
    const updated: Group = { ..._state.groups[index], name: trimmed, color: input.color ?? null };
    const groups = _state.groups.slice();
    groups[index] = updated;
    return { state: { ..._state, groups }, result: updated };
  },

  group_delete(_state, args) {
    const { id } = arg<{ id: string }>(args);
    const index = _state.groups.findIndex((group) => group.id === id);
    if (index === -1) throw notFound("group");
    const groups = _state.groups.filter((group) => group.id !== id);
    // Its connections lose their group without being edited (their `updated_at` is untouched).
    const connections: Connection[] = _state.connections.map((connection) =>
      connection.groupId === id ? { ...connection, groupId: null } : connection,
    );
    return {
      state: { ..._state, groups, connections },
      result: { groups, connections, quarantined: _state.quarantined },
    };
  },

  group_reorder(_state, args) {
    const { ids } = arg<{ ids: string[] }>(args);
    assertFullPermutation(
      ids,
      _state.groups.map((group) => group.id),
    );
    const groups = ids.map((target) => {
      const group = _state.groups.find((g) => g.id === target);
      if (!group) throw notFound("group");
      return group;
    });
    return { state: { ..._state, groups }, result: groups };
  },
};
