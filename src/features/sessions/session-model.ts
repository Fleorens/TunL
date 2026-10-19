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

/** What a tab runs: a shell (`ssh`) or a file explorer (`sftp`). RDP comes with T28. */
export type SessionKind = "ssh" | "sftp";

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
  /** What the tab runs: a shell, or a file explorer. */
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
  };
}

/**
 * Fold one backend event onto a session, returning a new object.
 *
 * - `step` replaces the line of the same kind and label, or is appended when it is new;
 * - `connected`, `closed`, `error` set the status (and the error / exit code);
 * - `log` carries no tab state, so the session is returned unchanged.
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
    case "log":
      return { ...session };
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
