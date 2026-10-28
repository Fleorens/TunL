// The live xterm ports of every open tab, keyed by tab id (docs/01 §6.2). Ports are objects, not data:
// they never enter the zustand state, so the store stays immutable and its tests clone-able.
// This module and `store.ts` import each other: `useSessions` is only read inside functions, never at load time.
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

/** A tab's acks are batched: sent once they are big, or a short time after the last, to avoid one IPC per block. */
const ACK_BATCH_BYTES = 256 * 1024;
const ACK_BATCH_DELAY_MS = 100;

/** One tab's port at a time; a reconnect reuses the same object. */
const ports = new Map<string, SessionPort>();

/** The port of a tab, or `null` before it opens and after it closes (SessionView renders the terminal when present). */
export function getSessionPort(id: string): SessionPort | null {
  return ports.get(id) ?? null;
}

/**
 * Attach a port to a tab, keeping it as-is on a reconnect. The sender forwards keys and size to the
 * current backend attempt, and only while the tab is connecting or connected. The size is always kept in
 * the session (the port reports each size once), so a reconnect opens the terminal at its current size.
 */
export function registerSessionPort(id: string): void {
  if (ports.has(id)) return;
  // The tab's output acks, batched then sent to the current attempt (T50).
  let acked = 0;
  let ackTimer: ReturnType<typeof setTimeout> | null = null;
  // The attempt the pending acks belong to: a reconnect restarts the shell on the Rust side, so acks
  // for the old attempt are dropped (T50).
  let lastRunId: string | null = null;
  const flushAcks = (): void => {
    if (acked === 0) return;
    const amount = acked;
    acked = 0;
    lastRunId = current(id)?.runId ?? null;
    if (ackTimer) {
      clearTimeout(ackTimer);
      ackTimer = null;
    }
    const session = current(id);
    if (!isLive(session)) return;
    ipc.sshAck(session.runId, amount).catch((error) => handlePortError(error));
  };
  const { port, push } = createTerminalPort({
    write(data) {
      const session = current(id);
      if (!isLive(session)) return;
      ipc.sshWrite(session.runId, data).catch((error) => handlePortError(error));
    },
    resize(cols, rows) {
      const size: TerminalSize = { cols, rows };
      useSessions.setState((state) => ({
        sessions: state.sessions.map((s) => (s.id === id ? { ...s, size } : s)),
      }));
      const session = current(id);
      if (!isLive(session)) return;
      ipc.sshResize(session.runId, size).catch((error) => handlePortError(error));
    },
    ack(bytes) {
      // A new attempt (reconnect): the shell restarted on the Rust side, drop the pending acks.
      const runId = current(id)?.runId ?? null;
      if (runId !== lastRunId) {
        if (ackTimer) {
          clearTimeout(ackTimer);
        }
        acked = 0;
        lastRunId = runId;
      }
      acked += bytes;
      if (acked >= ACK_BATCH_BYTES) {
        flushAcks();
      } else {
        ackTimer = setTimeout(flushAcks, ACK_BATCH_DELAY_MS);
      }
    },
  });
  ports.set(id, { port, push });
}

/**
 * Send the tab's kept size to its current attempt, once connected: a resize made before the backend
 * registered the session was refused (`notFound`), and the port does not repeat a size.
 */
export function sendSessionSize(id: string): void {
  const session = current(id);
  if (!isLive(session) || !session.size) return;
  ipc.sshResize(session.runId, session.size).catch((error) => handlePortError(error));
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
