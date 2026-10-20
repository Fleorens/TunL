// The state of one session tab: its connection steps, status, error, and the last known terminal size.
// Pure: every function returns a new object, never mutates its input (docs/01 §6.1).
import type { AppError } from "@/bindings/AppError";
import type { SessionEvent } from "@/bindings/SessionEvent";
import type { SessionTarget } from "@/bindings/SessionTarget";
import type { StepKind } from "@/bindings/StepKind";
import type { StepState } from "@/bindings/StepState";
import type { Status } from "@/components/StatusDot";
import type { TerminalSize } from "@/lib/ipc";

export type SessionStatus = "connecting" | "connected" | "closed" | "error";

/** What a tab runs: a shell (`ssh`), a file explorer (`sftp`), or a desktop (`rdp`). */
export type SessionKind = "ssh" | "sftp" | "rdp";

/** The most log lines a session keeps, so a long client run cannot grow the tab state without bound. */
export const LOG_LIMIT = 200;

/** One line of the connecting card: a step, what it is, and whether it started, passed, or failed. */
export interface SessionStepView {
  step: StepKind;
  label: string;
  state: StepState;
}

/** Everything a tab shows: the connection it is on, its steps, and the last backend run. */
export interface Session {
  /** The tab the user sees and closes. */
  id: string;
  /** What the tab runs: a shell, a file explorer, or a desktop. */
  kind: SessionKind;
  /** The backend session of the current attempt (`sessionId` of `ssh_open`); a reconnect gets a new one. */
  runId: string;
  title: string;
  target: SessionTarget;
  /** From a "saved" target; `null` for a quick target. */
  connectionId: string | null;
  status: SessionStatus;
  steps: readonly SessionStepView[];
  error: AppError | null;
  exitStatus: number | null;
  /** The last terminal size, kept across a reconnect so the terminal does not jump. */
  size: TerminalSize | null;
  /** The client's recent log lines, filtered and shown on the RDP card (T28b). */
  log: readonly string[];
}

/**
 * A brand-new tab: still connecting, nothing done yet. The first attempt reuses the tab id as the run.
 * An SFTP tab is the same session, of another kind.
 */
export function newSession(
  id: string,
  title: string,
  target: SessionTarget,
  kind: SessionKind = "ssh",
): Session {
  return {
    id,
    kind,
    runId: id,
    title,
    target,
    connectionId: target.type === "saved" ? target.connectionId : null,
    status: "connecting",
    steps: [],
    error: null,
    exitStatus: null,
    size: null,
    log: [],
  };
}

/**
 * Fold one backend event onto a session, returning a new object.
 *
 * - `step` replaces the line of the same kind and label, or is appended when it is new;
 * - `connected`, `closed`, `error` set the status (and the error / exit code);
 * - `log` appends the line, keeping its last `LOG_LIMIT` (a new object, never mutating the session).
 */
export function applySessionEvent(session: Session, event: SessionEvent): Session {
  switch (event.type) {
    case "step": {
      const next: SessionStepView = { step: event.step, label: event.label, state: event.state };
      const index = session.steps.findIndex(
        (s) => s.step === event.step && s.label === event.label,
      );
      const steps =
        index === -1
          ? [...session.steps, next]
          : session.steps.map((s, i) => (i === index ? next : s));
      return { ...session, steps };
    }
    case "connected":
      return { ...session, status: "connected" };
    case "closed":
      return { ...session, status: "closed", exitStatus: event.exitStatus };
    case "error":
      return { ...session, status: "error", error: event.error };
    case "log": {
      const log = [...session.log, event.line].slice(-LOG_LIMIT);
      return { ...session, log };
    }
  }
}

/**
 * Start a new attempt on the same tab: a fresh backend run, cleared steps and error, the tab and its
 * last size kept so the terminal does not resize on reconnect.
 */
export function restartSession(session: Session, runId: string): Session {
  return {
    ...session,
    runId,
    status: "connecting",
    steps: [],
    error: null,
    exitStatus: null,
    log: [],
  };
}

/** The next title that is not already in use: `web-01`, then `web-01 (2)`, `web-01 (3)`… */
export function uniqueTitle(name: string, taken: readonly string[]): string {
  if (!taken.includes(name)) return name;
  let next = 2;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const title of taken) {
    const match = title.match(new RegExp(`^${escaped} \\((\\d+)\\)$`));
    if (match) next = Math.max(next, Number(match[1]) + 1);
  }
  return `${name} (${next})`;
}

/** A quick target is titled like the ssh command line it came from (`user@host`, `host:port`). */
export function quickTitle(target: {
  host: string;
  port: number;
  username: string | null;
}): string {
  const host = target.username ? `${target.username}@${target.host}` : target.host;
  return target.port === 22 ? host : `${host}:${target.port}`;
}

/**
 * What an `open` step reads as: `sftp` opens SFTP, a bastion `tunnel` opens the tunnel, any other `open`
 * (a shell) and every other step keep their own key. The return type is the union of those i18n keys.
 */
export type StepKey =
  | "sessions.steps.open"
  | "sessions.steps.openSftp"
  | "sessions.steps.openTunnel"
  | `sessions.steps.${StepKind}`;

export function stepKey(step: { step: StepKind; label: string }): StepKey {
  if (step.step === "open") {
    if (step.label === "sftp") return "sessions.steps.openSftp";
    if (step.label === "tunnel") return "sessions.steps.openTunnel";
  }
  return `sessions.steps.${step.step}`;
}

/** The tab dot follows the status: connecting stays, online/offline/error map from connected/closed/error. */
export function tabStatus(status: SessionStatus): Status {
  switch (status) {
    case "connecting":
      return "connecting";
    case "connected":
      return "online";
    case "closed":
      return "offline";
    case "error":
      return "error";
  }
}
