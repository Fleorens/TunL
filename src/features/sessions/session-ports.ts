// The live xterm ports of every open tab, keyed by tab id (docs/01 §6.2). Ports are objects, not data:
// they never enter the zustand state, so the store stays immutable and its tests clone-able.
import { createTerminalPort, type TerminalPort } from "@/features/terminal/port";
import { notifyError, toAppError } from "@/lib/errors";
import { ipc, type TerminalSize } from "@/lib/ipc";
import type { Session } from "./session-model";
import { useSessions } from "./store";

/** A tab's terminal: subscribe for bytes, write keys, forward the size. `push` feeds backend output in. */
export interface SessionPort {
  port: TerminalPort;
  push(bytes: Uint8Array): void;
}

/** One tab's port at a time; a reconnect reuses the same object. */
const ports = new Map<string, SessionPort>();

/** The port of a tab, or `null` before it opens and after it closes (SessionView renders the terminal when present). */
export function getSessionPort(id: string): SessionPort | null {
  return ports.get(id) ?? null;
}

/** Whether a tab already has a port (a reconnect registers without recreating it). */
export function hasSessionPort(id: string): boolean {
  return ports.has(id);
}

/**
 * Attach a port to a tab, keeping it as-is on a reconnect. The sender forwards keys and size to the
 * current backend attempt, and only while the tab is connecting or connected; the size is kept in the
 * session so a reconnect does not resize the terminal.
 */
export function registerSessionPort(id: string): void {
  if (ports.has(id)) return;
  const { port, push } = createTerminalPort({
    write(data) {
      const session = current(id);
      if (!isLive(session)) return;
      ipc.sshWrite(session.runId, data).catch((error) => handlePortError(error));
    },
    resize(cols, rows) {
      const session = current(id);
      if (!isLive(session)) return;
      const size: TerminalSize = { cols, rows };
      useSessions.setState((state) => ({
        sessions: state.sessions.map((s) => (s.id === id ? { ...s, size } : s)),
      }));
      ipc.sshResize(session.runId, size).catch((error) => handlePortError(error));
    },
  });
  ports.set(id, { port, push });
}

/** Drop a tab's port, on close. */
export function removeSessionPort(id: string): void {
  ports.delete(id);
}

/** The session of a tab as it is now, or `null` when the tab is gone. */
function current(id: string): Session | null {
  return useSessions.getState().sessions.find((s) => s.id === id) ?? null;
}

function isLive(session: Session | null): session is Session {
  return session !== null && (session.status === "connecting" || session.status === "connected");
}

/**
 * A `notFound` means the attempt just ended: the backend session is gone, so the stray write is harmless.
 * Any other error is surfaced.
 */
function handlePortError(error: unknown): void {
  if (toAppError(error).kind === "notFound") return;
  notifyError(error);
}
