// The session tabs: open, switch, close (with confirmation), and reconnect (docs/01 §6.2).
// The live xterm ports live in `session-ports.ts`, never here, so this state stays immutable and clone-able.
import { create } from "zustand";
import type { Connection } from "@/bindings/Connection";
import type { SessionEvent } from "@/bindings/SessionEvent";
import type { SessionTarget } from "@/bindings/SessionTarget";
import { useConnections } from "@/features/connections/store";
import { useSettings } from "@/features/settings/store";
import { notifyError, toAppError } from "@/lib/errors";
import { ipc, type TerminalSize } from "@/lib/ipc";
import {
  applySessionEvent,
  newSession,
  restartSession,
  type Session,
  uniqueTitle,
} from "./session-model";
import { registerSessionPort, removeSessionPort, useSessionPort } from "./session-ports";

const DEFAULT_SIZE: TerminalSize = { cols: 80, rows: 24 };

interface SessionsState {
  sessions: readonly Session[];
  activeId: string | null;
  /** The tab waiting for the close confirmation, or null. */
  closing: string | null;
  /** Open a tab on a target, make it active, and start the attempt. Returns the tab id. */
  open: (target: SessionTarget, name: string) => string;
  activate: (id: string) => void;
  /** Alt+1…8, Alt+9 = last. */
  activateIndex: (index: number) => void;
  activateRelative: (delta: 1 | -1) => void;
  /** Queue the close of a connected session behind the confirmation dialog. */
  requestClose: (id: string) => void;
  confirmClose: () => void;
  cancelClose: () => void;
  close: (id: string) => void;
  /** A new attempt on the same tab, with a fresh backend run. */
  reconnect: (id: string) => void;
}

export const useSessions = create<SessionsState>()((set, get) => ({
  sessions: [],
  activeId: null,
  closing: null,

  open(target, name) {
    const id = crypto.randomUUID();
    const title = uniqueTitle(
      name,
      get().sessions.map((session) => session.title),
    );
    set((state) => ({
      sessions: [...state.sessions, newSession(id, title, target)],
      activeId: id,
    }));
    registerSessionPort(id);
    start(id, id);
    return id;
  },

  activate(id) {
    set({ activeId: id });
  },

  activateIndex(index) {
    set((state) => {
      const { sessions } = state;
      if (sessions.length === 0) return {};
      const target = sessions[Math.min(index, sessions.length - 1)];
      return target ? { activeId: target.id } : {};
    });
  },

  activateRelative(delta) {
    set((state) => {
      const { sessions } = state;
      if (sessions.length === 0) return {};
      const current = sessions.findIndex((session) => session.id === state.activeId);
      const next = (current + delta + sessions.length) % sessions.length;
      return { activeId: sessions[next].id };
    });
  },

  requestClose(id) {
    const session = get().sessions.find((s) => s.id === id);
    const confirm = useSettings.getState().settings?.ui.confirmCloseActiveSession === true;
    if (session?.status === "connected" && confirm) {
      set({ closing: id });
    } else {
      get().close(id);
    }
  },

  confirmClose() {
    const id = get().closing;
    set({ closing: null });
    if (id) get().close(id);
  },

  cancelClose() {
    set({ closing: null });
  },

  close(id) {
    const session = get().sessions.find((s) => s.id === id);
    if (session) {
      ipc.sessionClose(session.runId).catch(notifyError);
    }
    removeSessionPort(id);
    set((state) => {
      const remaining = state.sessions.filter((s) => s.id !== id);
      if (state.activeId !== id) return { sessions: remaining };
      return { sessions: remaining, activeId: neighbour(remaining, id)?.id ?? null };
    });
  },

  reconnect(id) {
    const session = get().sessions.find((s) => s.id === id);
    if (!session) return;
    const runId = crypto.randomUUID();
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? restartSession(s, runId) : s)),
      activeId: id,
    }));
    start(id, runId);
  },
}));

/**
 * Start one attempt: open the backend session, apply its events (only while they belong to this run),
 * and push its bytes to the tab's port. A refusal at the Target step becomes an error on the session.
 */
function start(id: string, runId: string): void {
  const session = useSessions.getState().sessions.find((s) => s.id === id);
  if (!session) return;

  const onEvent = (event: SessionEvent): void => {
    const current = useSessions.getState().sessions.find((s) => s.id === id);
    // A late event of a previous attempt (before a reconnect) must not touch this tab.
    if (!current || current.runId !== runId) return;
    useSessions.setState((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? applySessionEvent(s, event) : s)),
    }));
    if (event.type === "connected" && current.connectionId) {
      void touch(current.connectionId);
    }
  };

  const onOutput = (bytes: Uint8Array): void => {
    useSessionPort(id)?.push(bytes);
  };

  ipc
    .sshOpen(runId, session.target, session.size ?? DEFAULT_SIZE, { onEvent, onOutput })
    .catch((error) => {
      useSessions.setState((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === id && s.runId === runId
            ? applySessionEvent(s, { type: "error", error: toAppError(error) })
            : s,
        ),
      }));
    });
}

/** Record a recent connection: replace it in the connections store, or notify on failure. */
function touch(connectionId: string): Promise<Connection | null> {
  return useConnections.getState().touch(connectionId);
}

/** The next tab to focus when one closes: the neighbour just before it, or the last one. */
function neighbour(sessions: readonly Session[], removedId: string): Session | null {
  const index = sessions.findIndex((s) => s.id === removedId);
  return sessions[Math.min(index, sessions.length - 1)] ?? null;
}
