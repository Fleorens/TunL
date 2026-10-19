// Mock handlers for the SSH session commands (T19): the steps, a tiny shell, the refusals. The UI of
// T20–T21 is developed and tested against it, so its behaviour is a contract too.
//
// Live sessions live in a module-level `Map` (never in `MockState`, which must stay cloneable). Events
// go out through `setTimeout`, spaced by `MOCK_STEP_MS` (0 in test mode). Output is UTF-8 encoded.
import type { AppError } from "@/bindings/AppError";
import type { SessionEvent } from "@/bindings/SessionEvent";
import type { SessionTarget } from "@/bindings/SessionTarget";
import { jumpChainNames } from "@/features/connections/jump-hosts";
import type { Handler } from "./data";
import { arg } from "./data";
import { cancelMockPrompts } from "./prompts";
import { getScenario } from "./scenarios";

const MOCK_STEP_MS = import.meta.env.MODE === "test" ? 0 : 80;

interface SessionCallbacks {
  onEvent: (event: SessionEvent) => void;
  onOutput: (bytes: Uint8Array) => void;
}

export interface LiveSession {
  id: string;
  callbacks: SessionCallbacks;
  /** The prompt to print, e.g. `admin@192.168.1.10:~$ `. */
  prompt: string;
  /** The line being typed, run when a `\r` is received. */
  line: string;
  cols: number;
  rows: number;
  /** Every scheduled timer, so closing a session cancels them all. */
  timers: Array<ReturnType<typeof setTimeout>>;
}

export interface ResolvedTarget {
  host: string;
  port: number;
  user: string;
  /** The name printed in the banner: the connection name, or `user@host` for a quick target. */
  name: string;
  /** The bastions to cross first (dial order), empty for a direct connection or a quick target (T22). */
  bastions: string[];
  /** Wake this host before connecting (T29): a direct connection that asked for it. */
  wake: boolean;
  /** A quick target that refuses the connection at the Target step. */
  unreachable?: boolean;
}

/** Every live mock session, shell or SFTP. */
export const sessions = new Map<string, LiveSession>();

function validation(message: string): AppError {
  return { kind: "validation", message, detail: null };
}

function notFound(what: string): AppError {
  return { kind: "notFound", message: what, detail: null };
}

/** One scheduled send: wait `MOCK_STEP_MS`, then emit, tracking the timer so it can be cancelled. */
export function scheduler(session: LiveSession) {
  const wait = (): Promise<void> =>
    new Promise((resolve) => {
      session.timers.push(setTimeout(resolve, MOCK_STEP_MS));
    });
  // A session closed in the meantime sends nothing more (e.g. closed while a prompt was open).
  const event = async (e: SessionEvent): Promise<void> => {
    await wait();
    if (sessions.has(session.id)) session.callbacks.onEvent(e);
  };
  const output = async (text: string): Promise<void> => {
    await wait();
    if (sessions.has(session.id)) session.callbacks.onOutput(new TextEncoder().encode(text));
  };
  return { event, output };
}

/** Turn a `SessionTarget` into what the mock connects to, throwing the same refusals as the backend. */
export function resolveTarget(
  state: Parameters<Handler>[0],
  target: SessionTarget,
): ResolvedTarget {
  if (target.type === "saved") {
    const connection = state.connections.find((c) => c.id === target.connectionId);
    if (!connection) throw notFound(`connection ${target.connectionId}`);
    if (connection.settings.protocol !== "ssh") {
      throw validation("is not SSH");
    }
    const user = connection.username ?? "user";
    const bastions = jumpChainNames(state.connections, connection.jumpHostId ?? "");
    return {
      host: connection.host,
      port: connection.port,
      user,
      name: connection.name,
      bastions,
      // Wake a direct connection that asked for it (T29); never behind a bastion.
      wake: connection.wol?.wakeBeforeConnect === true && connection.jumpHostId == null,
    };
  }

  if (target.host === "" || target.host.includes(" ") || target.host.includes("!")) {
    throw validation("host must not be empty, spaced or contain `!`");
  }
  const user = target.username ?? "user";
  return {
    host: target.host,
    port: target.port,
    user,
    name: target.username ? `${target.username}@${target.host}` : target.host,
    bastions: [],
    wake: false,
    unreachable: target.host === "unreachable.test",
  };
}

/** Run one scenario for this connection at the given step, failing the attempt when it returns an error. */
async function scenario(
  session: LiveSession,
  target: ResolvedTarget,
  step: "hostKey" | "auth",
): Promise<AppError | null> {
  const found = getScenario(target.name);
  if (!found || found.step !== step) return null;
  return found.run({ sessionId: session.id, host: target.host, port: target.port });
}

/**
 * One step that may pose a prompt: `started`, the scenario, then `done`, or `failed` and the error.
 * Returns `false` when the attempt stops (failed, or the session was closed during the prompt).
 */
async function promptStep(
  session: LiveSession,
  target: ResolvedTarget,
  step: "hostKey" | "auth",
  label: string,
): Promise<boolean> {
  const { event } = scheduler(session);
  await event({ type: "step", step, label, state: "started" });
  const error = await scenario(session, target, step);
  if (!sessions.has(session.id)) return false;
  if (error) {
    await event({ type: "step", step, label, state: "failed" });
    await event({ type: "error", error });
    sessions.delete(session.id);
    return false;
  }
  await event({ type: "step", step, label, state: "done" });
  return true;
}

/**
 * The connecting steps shared by a shell and an SFTP tab: wake, bastions, target, host key, authentication.
 * Returns `false` when the attempt stops (failed, or the session was closed during a prompt).
 */
export async function connectSteps(session: LiveSession, target: ResolvedTarget): Promise<boolean> {
  const { event } = scheduler(session);
  const address = `${target.host}:${target.port}`;

  // Wake the host first, if this direct connection asked for it (T29): the mock comes alive at once.
  if (target.wake) {
    await event({ type: "step", step: "wake", label: target.name, state: "started" });
    await event({ type: "step", step: "wake", label: target.name, state: "done" });
  }

  // One Hop step per bastion, in dial order (the first dialled first, T22).
  for (const bastion of target.bastions) {
    await event({ type: "step", step: "hop", label: bastion, state: "started" });
    await event({ type: "step", step: "hop", label: bastion, state: "done" });
  }

  await event({ type: "step", step: "target", label: address, state: "started" });
  if (target.unreachable) {
    await event({ type: "step", step: "target", label: address, state: "failed" });
    await event({
      type: "error",
      error: { kind: "network", message: `connection refused by ${address}`, detail: null },
    });
    sessions.delete(session.id);
    return false;
  }
  await event({ type: "step", step: "target", label: address, state: "done" });

  if (!(await promptStep(session, target, "hostKey", target.host))) return false;
  return promptStep(session, target, "auth", target.user);
}

/** The steps, the prompts of the connection's scenario, the connected banner. The session stays open. */
async function runSession(session: LiveSession, target: ResolvedTarget): Promise<void> {
  const { event, output } = scheduler(session);
  if (!(await connectSteps(session, target))) return;

  await event({ type: "step", step: "open", label: "shell", state: "started" });
  await event({ type: "step", step: "open", label: "shell", state: "done" });

  await event({ type: "connected" });
  await output(`Welcome to ${target.name} — TunL mock shell\r\n`);
  await output(session.prompt);
}

/** Run one line when a `\r` is received, then print the next prompt (unless the session closes). */
async function runLine(session: LiveSession, s: ReturnType<typeof scheduler>): Promise<void> {
  const { event, output } = s;
  const line = session.line.trim();
  await output("\r\n");

  const exit = line.match(/^exit(?:\s+(\d+))?$/);
  if (exit) {
    const code = exit[1] ? Number(exit[1]) : 0;
    await output("logout\r\n");
    await event({ type: "closed", reason: "remoteClosed", exitStatus: code });
    sessions.delete(session.id);
    return;
  }
  if (line === "stty size") {
    await output(`${session.rows} ${session.cols}\r\n`);
  } else if (/^echo/.test(line) && (line === "echo" || line.startsWith("echo "))) {
    await output(`${line.replace(/^echo\s*/, "")}\r\n`);
  } else if (line !== "") {
    const command = line.split(/\s+/)[0];
    await output(`mock: ${command}: command not found\r\n`);
  }
  await output(session.prompt);
}

/** Feed typed characters: echo them, erase with backspace, run a line on Enter. */
async function feed(session: LiveSession, input: string): Promise<void> {
  const s = scheduler(session);
  for (const ch of input) {
    if (ch === "\r") {
      await runLine(session, s);
      session.line = "";
    } else if (ch === "\u007f") {
      session.line = session.line.slice(0, -1);
      await s.output("\b \b");
    } else if (ch === "\u0003") {
      await s.output("^C\r\n");
      session.line = "";
      await s.output(session.prompt);
    } else {
      session.line += ch;
      await s.output(ch);
    }
  }
}

function open(
  state: Parameters<Handler>[0],
  args: Record<string, unknown>,
): { state: Parameters<Handler>[0]; result: unknown } {
  const { sessionId, target, cols, rows, onEvent, onOutput } = arg<{
    sessionId: string;
    target: SessionTarget;
    cols: number;
    rows: number;
    onEvent: SessionCallbacks["onEvent"];
    onOutput: SessionCallbacks["onOutput"];
  }>(args);

  // Refusals: nothing starts, no event is emitted.
  if (!(cols >= 1 && cols <= 1000)) throw validation("out of range");
  if (!(rows >= 1 && rows <= 500)) throw validation("out of range");
  if (sessions.has(sessionId)) throw validation("is already open");
  const resolved = resolveTarget(state, target);

  const session: LiveSession = {
    id: sessionId,
    callbacks: { onEvent, onOutput },
    prompt: `${resolved.user}@${resolved.host}:~$ `,
    line: "",
    cols,
    rows,
    timers: [],
  };
  sessions.set(sessionId, session);
  // The scenario runs in the background; the command answers at once, like the backend.
  void runSession(session, resolved);
  return { state, result: null };
}

function write(
  _state: Parameters<Handler>[0],
  args: Record<string, unknown>,
): { state: Parameters<Handler>[0]; result: unknown } {
  const { sessionId, data } = arg<{ sessionId: string; data: string }>(args);
  const session = sessions.get(sessionId);
  if (!session) throw notFound(`session ${sessionId}`);
  void feed(session, data);
  return { state: _state, result: null };
}

function resize(
  _state: Parameters<Handler>[0],
  args: Record<string, unknown>,
): { state: Parameters<Handler>[0]; result: unknown } {
  const { sessionId, cols, rows } = arg<{ sessionId: string; cols: number; rows: number }>(args);
  if (!(cols >= 1 && cols <= 1000)) throw validation("out of range");
  if (!(rows >= 1 && rows <= 500)) throw validation("out of range");
  const session = sessions.get(sessionId);
  if (!session) throw notFound(`session ${sessionId}`);
  session.cols = cols;
  session.rows = rows;
  return { state: _state, result: null };
}

function close(
  _state: Parameters<Handler>[0],
  args: Record<string, unknown>,
): { state: Parameters<Handler>[0]; result: unknown } {
  const { sessionId } = arg<{ sessionId: string }>(args);
  const session = sessions.get(sessionId);
  if (session) {
    for (const timer of session.timers) clearTimeout(timer);
    sessions.delete(sessionId);
  }
  // Cancel any prompt waiting on this session so a closed tab stops asking (T21b).
  cancelMockPrompts(sessionId);
  // Closing is idempotent and sends no event (the UI closed the tab itself).
  return { state: _state, result: null };
}

export const sessionHandlers: Record<string, Handler<Record<string, unknown>>> = {
  ssh_open: open,
  ssh_write: write,
  ssh_resize: resize,
  session_close: close,
};

/** Drop every live session and cancel its timers, for `resetMockBackend()`. */
export function resetMockSessions(): void {
  for (const session of sessions.values()) {
    for (const timer of session.timers) clearTimeout(timer);
  }
  sessions.clear();
}
