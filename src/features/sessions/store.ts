// The session tabs: open, switch, close (with confirmation), and reconnect (docs/01 §6.2).
// The live xterm ports live in `session-ports.ts`, never here, so this state stays immutable and clone-able.
import { create } from "zustand";
import type { SessionEvent } from "@/bindings/SessionEvent";
import type { SessionTarget } from "@/bindings/SessionTarget";
import { useConnections } from "@/features/connections/store";
import { usePrompts } from "@/features/prompts/store";
import { useSettings } from "@/features/settings/store";
import { notifyError, toAppError } from "@/lib/errors";
import { ipc, type TerminalSize } from "@/lib/ipc";
import {
  applySessionEvent,
  newSession,
  restartSession,
  type Session,
  type SessionKind,
  uniqueTitle,
} from "./session-model";
import {
  getSessionPort,
  registerSessionPort,
  removeSessionPort,
  sendSessionSize,
} from "./session-ports";
import { cdCommand, hasControlChar } from "./shell-quote";
import { moveTab, neighbourTab, relativeTab, SETTINGS_TAB, tabIds } from "./tabs";

const DEFAULT_SIZE: TerminalSize = { cols: 80, rows: 24 };

interface SessionsState {
  sessions: readonly Session[];
  activeId: string | null;
  /** The session tab ids waiting for the close confirmation, or null. */
  closing: readonly string[] | null;
  /** The Settings tab is open (a virtual tab, never a session id). */
  settingsOpen: boolean;
  /** The folder a freshly opened SSH tab should `cd` into, keyed by tab id, removed on close. */
  startDirs: Record<string, string>;
  /** Open a tab on a target, make it active, and start the attempt. Returns the tab id. */
  open: (
    target: SessionTarget,
    name: string,
    kind?: SessionKind,
    options?: { dir?: string },
  ) => string;
  activate: (id: string) => void;
  /** Alt+1…8, Alt+9 = last. */
  activateIndex: (index: number) => void;
  activateRelative: (delta: 1 | -1) => void;
  /** Open the Settings tab and make it active (a second open goes to the same tab). */
  openSettings: () => void;
  /** Close the Settings tab; focus the tab that was next to it. */
  closeSettings: () => void;
  /** Reorder the sessions following `ids`: an unknown id is dropped, an absent one stays last. */
  reorder: (ids: readonly string[]) => void;
  /** Move the active tab one step in the row, without wrapping (nothing at an edge). */
  moveActive: (delta: 1 | -1) => void;
  /** Open a new tab on the same target and kind as `id`, active (an SSH `cd` folder is kept). */
  duplicate: (id: string) => void;
  /** Close the non-connected tabs now; the connected ones, if any and confirmation is on, wait here. */
  requestCloseMany: (ids: readonly string[]) => void;
  /** Close a single tab (the Settings tab closes without confirmation). */
  requestClose: (id: string) => void;
  /** Close every tab in `closing`. */
  confirmClose: () => void;
  /** Keep every tab in `closing`. */
  cancelClose: () => void;
  /** Close every tab but `id` (the Settings tab is never closed). */
  closeOthers: (id: string) => void;
  /** Close every tab to the right of `id` (the Settings tab is never closed). */
  closeRight: (id: string) => void;
  close: (id: string) => void;
  /** A new attempt on the same tab, with a fresh backend run. */
  reconnect: (id: string) => void;
}

export const useSessions = create<SessionsState>()((set, get) => ({
  sessions: [],
  activeId: null,
  closing: null,
  settingsOpen: false,
  startDirs: {},

  open(target, name, kind = "ssh", options) {
    const id = crypto.randomUUID();
    const title = uniqueTitle(
      name,
      get().sessions.map((session) => session.title),
    );
    // A folder to land in lives on the store, not on the `Session` (its shape is fixed by its test). One with a
    // control character is dropped: the terminal's line editor would act on it before the shell reads the quotes.
    const dir = options?.dir;
    const startDir = kind === "ssh" && dir && !hasControlChar(dir) ? dir : undefined;
    // An SFTP tab has no terminal port; only SSH registers one.
    if (kind === "ssh") registerSessionPort(id);
    set((state) => ({
      sessions: [...state.sessions, newSession(id, title, target, kind)],
      activeId: id,
      ...(startDir ? { startDirs: { ...state.startDirs, [id]: startDir } } : {}),
    }));
    start(id, id);
    return id;
  },

  activate(id) {
    set({ activeId: id });
  },

  activateIndex(index) {
    set((state) => {
      const ids = tabIds(state.sessions, state.settingsOpen);
      if (ids.length === 0) return {};
      const target = ids[Math.min(index, ids.length - 1)];
      return target ? { activeId: target } : {};
    });
  },

  activateRelative(delta) {
    set((state) => {
      const next = relativeTab(tabIds(state.sessions, state.settingsOpen), state.activeId, delta);
      return next ? { activeId: next } : {};
    });
  },

  openSettings() {
    set({ settingsOpen: true, activeId: SETTINGS_TAB });
  },

  closeSettings() {
    set((state) => ({
      settingsOpen: false,
      activeId:
        state.activeId === SETTINGS_TAB
          ? (neighbourTab(tabIds(state.sessions, state.settingsOpen), SETTINGS_TAB) ?? null)
          : state.activeId,
    }));
  },

  /** Reorder the sessions following `ids`: an unknown id is dropped, an absent one keeps its place last. */
  reorder(ids) {
    set((state) => {
      const byId = new Map(state.sessions.map((session) => [session.id, session]));
      const ordered = ids
        .map((id) => byId.get(id))
        .filter((session): session is Session => session !== undefined);
      const absent = state.sessions.filter((session) => !ids.includes(session.id));
      return { sessions: [...ordered, ...absent] };
    });
  },

  /** Move the active tab one step in the row, without wrapping; the Settings tab stays last. */
  moveActive(delta) {
    set((state) => {
      const activeId = state.activeId;
      if (activeId === null) return {};
      const ids = tabIds(state.sessions, state.settingsOpen);
      const index = ids.indexOf(activeId);
      if (index === -1) return {};
      const target = index + delta;
      if (target < 0 || target >= ids.length) return {};
      const byId = new Map(state.sessions.map((session) => [session.id, session]));
      const sessions = moveTab(ids, activeId, target)
        .filter((id) => id !== SETTINGS_TAB)
        .map((id) => byId.get(id))
        .filter((session): session is Session => session !== undefined);
      return { sessions };
    });
  },

  /** Open a new tab on the same target and kind as `id`, active; an SSH `cd` folder is kept. */
  duplicate(id) {
    const session = get().sessions.find((s) => s.id === id);
    if (!session) return;
    const startDir = get().startDirs[id];
    get().open(
      session.target,
      session.title,
      session.kind,
      startDir ? { dir: startDir } : undefined,
    );
  },

  /**
   * Close the non-connected tabs now; the connected ones, if there is at least one and confirmation is on,
   * wait in `closing` for a single confirmation (otherwise they close now too, no dialog).
   */
  requestCloseMany(ids) {
    const confirm = useSettings.getState().settings?.ui.confirmCloseActiveSession === true;
    const connected: string[] = [];
    for (const id of ids) {
      if (id === SETTINGS_TAB) {
        get().closeSettings();
        continue;
      }
      const session = get().sessions.find((s) => s.id === id);
      if (!session) continue;
      if (session.status === "connected") {
        connected.push(id);
      } else {
        get().close(id);
      }
    }
    if (connected.length === 0) return;
    if (confirm) {
      set({ closing: connected });
    } else {
      for (const id of connected) get().close(id);
    }
  },

  requestClose(id) {
    get().requestCloseMany([id]);
  },

  confirmClose() {
    const ids = get().closing;
    set({ closing: null });
    for (const id of ids ?? []) get().close(id);
  },

  cancelClose() {
    set({ closing: null });
  },

  closeOthers(id) {
    get().requestCloseMany(
      get()
        .sessions.filter((s) => s.id !== id)
        .map((s) => s.id),
    );
  },

  closeRight(id) {
    const ids = tabIds(get().sessions, get().settingsOpen);
    const index = ids.indexOf(id);
    if (index === -1) return;
    get().requestCloseMany(ids.slice(index + 1).filter((tabId) => tabId !== SETTINGS_TAB));
  },

  close(id) {
    const session = get().sessions.find((s) => s.id === id);
    if (session) {
      // Dropping this session's prompt removes its dialogue from the queue (the backend cancels its wait).
      usePrompts.getState().dropSession(session.runId);
      ipc.sessionClose(session.runId).catch(notifyError);
    }
    removeSessionPort(id);
    set((state) => {
      const remaining = state.sessions.filter((s) => s.id !== id);
      const startDirs = Object.fromEntries(
        Object.entries(state.startDirs).filter(([key]) => key !== id),
      );
      if (state.activeId !== id) return { sessions: remaining, startDirs };
      return {
        sessions: remaining,
        startDirs,
        activeId: neighbourTab(tabIds(state.sessions, state.settingsOpen), id) ?? null,
      };
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
    const next = applySessionEvent(current, event);
    useSessions.setState((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? next : s)),
      // A pending close confirmation no longer applies once the session is not connected: drop its id.
      closing:
        state.closing?.includes(id) && next.status !== "connected"
          ? state.closing.filter((closingId) => closingId !== id)
          : state.closing,
    }));
    // When the attempt ends (error or closed), drop this run's pending questions: an answer typed
    // after the backend abandoned its wait (PROMPT_TIMEOUT) would otherwise go into the void.
    if (current.status !== next.status && (next.status === "error" || next.status === "closed")) {
      usePrompts.getState().dropSession(runId);
    }
    if (event.type === "connected") {
      // An SFTP tab has no terminal to size; only SSH does.
      if (session.kind === "ssh") sendSessionSize(id);
      // A folder kept for this tab goes out on every connect, so a reconnect lands in it again.
      const startDir = useSessions.getState().startDirs[id];
      if (session.kind === "ssh" && startDir) {
        getSessionPort(id)?.port.write(cdCommand(startDir));
      }
      if (current.connectionId) void useConnections.getState().touch(current.connectionId);
    }
  };

  const onOutput = (bytes: Uint8Array): void => {
    getSessionPort(id)?.push(bytes);
  };

  const onError = (error: unknown): void => {
    useSessions.setState((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id && s.runId === runId
          ? applySessionEvent(s, { type: "error", error: toAppError(error) })
          : s,
      ),
    }));
  };

  openBackend(session, runId, onEvent, onOutput).catch(onError);
}

/**
 * Choose the backend call for this tab's kind: RDP against its saved connection, SFTP against its target,
 * otherwise a shell with its terminal size and callbacks (events and bytes through the two channels).
 */
function openBackend(
  session: Session,
  runId: string,
  onEvent: (event: SessionEvent) => void,
  onOutput: (bytes: Uint8Array) => void,
): Promise<unknown> {
  if (session.kind === "rdp") {
    if (!session.connectionId) {
      return Promise.reject(new Error("an RDP tab needs a saved connection"));
    }
    return ipc.rdpOpen(runId, session.connectionId, onEvent);
  }
  if (session.kind === "sftp") {
    return ipc.sftpOpen(runId, session.target, onEvent);
  }
  return ipc.sshOpen(runId, session.target, session.size ?? DEFAULT_SIZE, { onEvent, onOutput });
}
