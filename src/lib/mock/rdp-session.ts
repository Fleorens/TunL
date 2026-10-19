// Mock handlers for the RDP session command (T28): a tab goes through the connecting steps (wake, the
// bastion's SSH steps, the tunnel), then launches the FreeRDP client. The UI of T28b is developed against
// it, so its behaviour is a contract too. Live tabs live in a module-level map (never in `MockState`, which
// must stay cloneable); events go out through `setTimeout`, spaced by `MOCK_STEP_MS` (0 in test mode).
import type { AppError } from "@/bindings/AppError";
import type { Connection } from "@/bindings/Connection";
import type { SessionEvent } from "@/bindings/SessionEvent";
import type { StepKind } from "@/bindings/StepKind";
import type { Handler, MockState } from "./data";
import { arg } from "./data";
import { detectClient } from "./rdp";

const MOCK_STEP_MS = import.meta.env.MODE === "test" ? 0 : 80;

/** The fixed loopback port the mock tunnel listens on (the backend picks a free one). */
export const MOCK_TUNNEL_PORT = 40123;

interface LiveRdpSession {
  id: string;
  callbacks: { onEvent: (event: SessionEvent) => void };
  /** Every scheduled timer, so a reset cancels them all. */
  timers: Array<ReturnType<typeof setTimeout>>;
}

/** Every live mock RDP tab. */
export const rdpSessions = new Map<string, LiveRdpSession>();

function validation(message: string): AppError {
  return { kind: "validation", message, detail: null };
}

function notFound(what: string): AppError {
  return { kind: "notFound", message: what, detail: null };
}

/** One scheduled send: wait `MOCK_STEP_MS`, then emit (unless the session was closed), tracking the timer. */
function scheduler(session: LiveRdpSession) {
  const wait = (): Promise<void> =>
    new Promise((resolve) => {
      session.timers.push(setTimeout(resolve, MOCK_STEP_MS));
    });
  const event = async (e: SessionEvent): Promise<void> => {
    await wait();
    if (rdpSessions.has(session.id)) session.callbacks.onEvent(e);
  };
  return { event };
}

/** One step, emitted started then done, in one call. */
async function step(
  event: (e: SessionEvent) => Promise<void>,
  kind: StepKind,
  label: string,
): Promise<void> {
  await event({ type: "step", step: kind, label, state: "started" });
  await event({ type: "step", step: kind, label, state: "done" });
}

/**
 * The connecting steps of an RDP tab: the optional wake, the bastion's SSH steps and the tunnel, then the
 * launch. The FreeRDP output is simulated by two info logs, after the tab is connected.
 */
async function runRdp(
  session: LiveRdpSession,
  connection: Connection,
  clientPath: string,
  bastion: Connection | undefined,
): Promise<void> {
  const { event } = scheduler(session);
  const label = clientPath.split("/").pop() ?? clientPath;

  // Wake the host first, if this direct connection asked for it (T29); never behind a bastion.
  if (connection.wol?.wakeBeforeConnect === true && connection.jumpHostId == null) {
    await step(event, "wake", connection.name);
  }

  // Behind a bastion: the bastion's SSH steps, then the tunnel, then the client pointed at it.
  if (bastion) {
    await step(event, "target", `${bastion.host}:${bastion.port}`);
    await step(event, "hostKey", bastion.host);
    await step(event, "auth", bastion.username ?? "user");
    await step(event, "open", "tunnel");
    await event({
      type: "log",
      line: `tunnel 127.0.0.1:${MOCK_TUNNEL_PORT} → ${connection.host}:${connection.port}`,
    });
  }

  // The launch: the client's file name is the step label.
  await step(event, "launch", label);

  // The client runs, then the tab closes. Two info logs simulate the FreeRDP output stream.
  if (!rdpSessions.has(session.id)) return;
  await event({ type: "connected" });
  await event({ type: "log", line: `[INFO][com.freerdp.core] connected to ${connection.host}` });
  await event({ type: "log", line: "[INFO][com.freerdp.core] Connection successful" });
}

function open(
  state: MockState,
  args: Record<string, unknown>,
): { state: MockState; result: unknown } {
  const { sessionId, connectionId, onEvent } = arg<{
    sessionId: string;
    connectionId: string;
    onEvent: (event: SessionEvent) => void;
  }>(args);

  // Refusals: nothing starts, no event is emitted.
  if (rdpSessions.has(sessionId)) throw validation("is already open");
  const connection = state.connections.find((c) => c.id === connectionId);
  if (!connection) throw notFound(`connection ${connectionId}`);
  if (connection.settings.protocol !== "rdp") throw validation("is not RDP");
  // The client must be a FreeRDP 3 binary; a forced wrong path is a missing client (comes back at once).
  const client = detectClient(state);

  const bastion = connection.jumpHostId
    ? state.connections.find((c) => c.id === connection.jumpHostId)
    : undefined;

  const session: LiveRdpSession = { id: sessionId, callbacks: { onEvent }, timers: [] };
  rdpSessions.set(sessionId, session);
  // The steps run in the background; the command answers at once, like the backend.
  void runRdp(session, connection, client.path, bastion);
  return { state, result: null };
}

export const rdpSessionHandlers: Record<string, Handler<Record<string, unknown>>> = {
  rdp_open: open,
};

/** Drop every live RDP tab and cancel its timers, for `resetMockBackend()`. */
export function resetMockRdpSessions(): void {
  for (const session of rdpSessions.values()) {
    for (const timer of session.timers) clearTimeout(timer);
  }
  rdpSessions.clear();
}
