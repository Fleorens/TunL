// Mock handlers for the connection commands. Each builds a new state and returns it (never mutates).
import type { AppError } from "@/bindings/AppError";
import type { Connection } from "@/bindings/Connection";
import type { ConnectionInput } from "@/bindings/ConnectionInput";
import type { Handler, MockState } from "./data";
import { arg } from "./data";

function validation(message: string): AppError {
  return { kind: "validation", message, detail: null };
}

function notFound(what: string): AppError {
  return { kind: "notFound", message: `${what} not found`, detail: null };
}

/** Trim, and reject a blank name — the one bit of validation the editor does not have to cover. */
function trimmedName(name: string): string {
  const value = name.trim();
  if (value === "") throw validation("name: must not be empty");
  return value;
}

function nonEmptyHost(host: string): string {
  const value = host.trim();
  if (value === "") throw validation("host: must not be empty");
  return value;
}

/** The first `base (n)` not already used by another connection. */
function freeName(base: string, connections: readonly Connection[]): string {
  let n = 2;
  while (connections.some((connection) => connection.name === `${base} (${n})`)) n += 1;
  return `${base} (${n})`;
}

function withConnection(
  state: MockState,
  connection: Connection,
): { state: MockState; result: Connection } {
  return {
    state: { ...state, connections: [...state.connections, connection] },
    result: connection,
  };
}

function replaceConnection(
  state: MockState,
  index: number,
  connection: Connection,
): { state: MockState; result: Connection } {
  const connections = state.connections.slice();
  connections[index] = connection;
  return { state: { ...state, connections }, result: connection };
}

function slot(state: MockState, id: string): number {
  const index = state.connections.findIndex((connection) => connection.id === id);
  if (index === -1) throw notFound("connection");
  return index;
}

export const connectionHandlers: Record<string, Handler<Record<string, unknown>>> = {
  connection_create(_state, args) {
    const { input } = arg<{ input: ConnectionInput }>(args);
    const nowMs = Date.now();
    const connection: Connection = {
      id: crypto.randomUUID(),
      name: trimmedName(input.name),
      host: nonEmptyHost(input.host),
      port: input.port,
      username: input.username,
      groupId: input.groupId,
      tags: [...input.tags],
      favorite: input.favorite,
      color: input.color,
      notes: input.notes,
      jumpHostId: input.jumpHostId,
      wol: input.wol,
      settings: input.settings,
      createdAt: nowMs,
      updatedAt: nowMs,
      lastConnectedAt: null,
    };
    return withConnection(_state, connection);
  },

  connection_update(_state, args) {
    const { id, input } = arg<{ id: string; input: ConnectionInput }>(args);
    const index = slot(_state, id);
    const original = _state.connections[index];
    const updated: Connection = {
      ...original,
      name: trimmedName(input.name),
      host: nonEmptyHost(input.host),
      port: input.port,
      username: input.username,
      groupId: input.groupId,
      tags: [...input.tags],
      favorite: input.favorite,
      color: input.color,
      notes: input.notes,
      jumpHostId: input.jumpHostId,
      wol: input.wol,
      settings: input.settings,
      createdAt: original.createdAt,
      updatedAt: Date.now(),
      lastConnectedAt: original.lastConnectedAt,
    };
    return replaceConnection(_state, index, updated);
  },

  connection_duplicate(_state, args) {
    const { id } = arg<{ id: string }>(args);
    const original = _state.connections.find((connection) => connection.id === id);
    if (!original) throw notFound("connection");
    const duplicated: Connection = {
      ...original,
      id: crypto.randomUUID(),
      name: freeName(original.name, _state.connections),
      favorite: false,
      lastConnectedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    return withConnection(_state, duplicated);
  },

  connection_delete(_state, args) {
    const { id } = arg<{ id: string }>(args);
    slot(_state, id);
    const usedBy = _state.connections
      .filter((connection) => connection.id !== id && connection.jumpHostId === id)
      .map((connection) => connection.name)
      .sort();
    if (usedBy.length > 0) {
      throw {
        kind: "inUse",
        message: "connection is used as a jump host",
        detail: { type: "inUse", names: usedBy },
      };
    }
    return {
      state: {
        ..._state,
        connections: _state.connections.filter((connection) => connection.id !== id),
      },
      result: null,
    };
  },

  connection_set_favorite(_state, args) {
    const { id, favorite } = arg<{ id: string; favorite: boolean }>(args);
    const index = slot(_state, id);
    const updated: Connection = { ..._state.connections[index], favorite, updatedAt: Date.now() };
    return replaceConnection(_state, index, updated);
  },

  connection_touch(_state, args) {
    const { id } = arg<{ id: string }>(args);
    const index = slot(_state, id);
    const updated: Connection = { ..._state.connections[index], lastConnectedAt: Date.now() };
    return replaceConnection(_state, index, updated);
  },
};
