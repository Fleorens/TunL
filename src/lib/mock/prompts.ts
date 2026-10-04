// Mock handlers for the prompt commands (T17). No prompt is ever posed yet (T21b will): every answer
// is `notFound`, and removing from TunL's empty known_hosts removes nothing.
import type { AppError } from "@/bindings/AppError";
import type { Handler } from "./data";
import { arg } from "./data";

function notFound(what: string): AppError {
  return { kind: "notFound", message: what, detail: null };
}

export const promptHandlers: Record<string, Handler<Record<string, unknown>>> = {
  prompt_answer(_state, args) {
    const { id } = arg<{ id: string }>(args);
    // Nothing is waiting for this id: the arguments were read, the broker answered "not found".
    throw notFound(`prompt ${id}`);
  },

  known_host_remove(_state, args) {
    arg<{ host: string; port: number }>(args);
    // TunL's own known_hosts is empty in a fresh config dir.
    return { state: _state, result: 0 };
  },
};
