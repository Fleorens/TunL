// Mock handlers for the secret commands. Each builds a new state and returns it (never mutates).
// The mock stores only the *keys* `"<connectionId>:<kind>"`, never the value (S1).
import type { AppError } from "@/bindings/AppError";
import type { SecretKind } from "@/bindings/SecretKind";
import { hasControlChars } from "../../features/connections/editor/validation";
import type { Handler, MockState } from "./data";
import { arg } from "./data";

const MAX_CHARS = 1024;

function validation(message: string): AppError {
  return { kind: "validation", message, detail: null };
}

function notFound(what: string): AppError {
  return { kind: "notFound", message: `${what} not found`, detail: null };
}

/** `"<connectionId>:<kind>"`, the mock's only record of a stored secret. */
function key(connectionId: string, kind: SecretKind): string {
  return `${connectionId}:${kind}`;
}

/** True when the connection exists in the store — the backend looks it up the same way. */
function hasConnection(state: MockState, connectionId: string): boolean {
  return state.connections.some((connection) => connection.id === connectionId);
}

export const secretHandlers: Record<string, Handler<Record<string, unknown>>> = {
  secret_set(_state, args) {
    const { connectionId, kind, value } = arg<{
      connectionId: string;
      kind: SecretKind;
      value: string;
    }>(args);

    if (value === "") throw validation("value: must not be empty");
    if (value.length > MAX_CHARS) throw validation("value: is too long");
    if (hasControlChars(value)) throw validation("value: must not contain control characters");
    if (!hasConnection(_state, connectionId)) throw notFound(`connection ${connectionId}`);

    const next = _state.secrets.includes(key(connectionId, kind))
      ? _state.secrets
      : [..._state.secrets, key(connectionId, kind)];
    return { state: { ..._state, secrets: next }, result: null };
  },

  secret_has(_state, args) {
    const { connectionId, kind } = arg<{ connectionId: string; kind: SecretKind }>(args);
    return { state: _state, result: _state.secrets.includes(key(connectionId, kind)) };
  },

  secret_delete(_state, args) {
    const { connectionId, kind } = arg<{ connectionId: string; kind: SecretKind }>(args);
    const secret = key(connectionId, kind);
    if (!_state.secrets.includes(secret)) return { state: _state, result: null };
    return {
      state: { ..._state, secrets: _state.secrets.filter((item) => item !== secret) },
      result: null,
    };
  },
};
