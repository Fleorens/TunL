// Mock Wake-on-LAN (T29): send a connection's magic packet. The backend refuses an unknown or an
// unconfigured connection; an configured one sends its packet (the mock answers at once, no wait).
import type { AppError } from "@/bindings/AppError";
import type { Handler } from "./data";
import { arg } from "./data";

function notFound(what: string): AppError {
  return { kind: "notFound", message: what, detail: null };
}

function validation(message: string): AppError {
  return { kind: "validation", message, detail: null };
}

export const wolHandlers: Record<string, Handler<{ id: string }>> = {
  wol_wake(state, args) {
    const { id } = arg<{ id: string }>(args);
    const connection = state.connections.find((connection) => connection.id === id);
    if (!connection) throw notFound(`connection ${id}`);
    if (!connection.wol) throw validation("wol: is not configured");
    return { state, result: null };
  },
};
