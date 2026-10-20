// Mock handlers for the RDP session command (T28): a tab goes through the connecting steps (wake, the
// bastion's SSH steps, the tunnel), then launches the FreeRDP client. The UI of T28b is developed against
// it, so its behaviour is a contract too. An RDP tab is a `LiveSession` of `mock/sessions.ts` (with no
// terminal output), so `session_close` and `resetMockBackend()` stop it like any other tab.
import type { Connection } from "@/bindings/Connection";
import type { SessionEvent } from "@/bindings/SessionEvent";
import type { StepKind } from "@/bindings/StepKind";
import { jumpChainNames } from "@/features/connections/jump-hosts";
import type { Handler, MockState } from "./data";
import { arg } from "./data";
import { mockDetect } from "./rdp";
import { type LiveSession, notFound, scheduler, sessions, validation } from "./sessions";

/** The fixed loopback port the mock tunnel listens on (the backend picks a free one). */
export const MOCK_TUNNEL_PORT = 40123;

/**
 * Exit codes a named mock client leaves on its own, after its two info logs: the client name (from its
 * path) maps to the exit status the tab reports as `processExited`.
 */
export const MOCK_RDP_EXITS = { "win-desktop": 134 };

/** One step, emitted started then done, in one call. */
async function step(
  event: (e: SessionEvent) => Promise<void>,
  kind: StepKind,
  label: string,
): Promise<void> {
  await event({ type: "step", step: kind, label, state: "started" });
  await event({ type: "step", step: kind, label, state: "done" });
}

/** The bastion's SSH steps (its own chain's hops, target, host key, authentication), then the tunnel. */
async function tunnelSteps(
  event: (e: SessionEvent) => Promise<void>,
  state: MockState,
  connection: Connection,
  bastion: Connection,
): Promise<void> {
  for (const hop of jumpChainNames(state.connections, bastion.jumpHostId ?? "")) {
    await step(event, "hop", hop);
  }
  await step(event, "target", `${bastion.host}:${bastion.port}`);
  await step(event, "hostKey", bastion.host);
  await step(event, "auth", bastion.username ?? "user");
  await step(event, "open", "tunnel");
  await event({
    type: "log",
    line: `tunnel 127.0.0.1:${MOCK_TUNNEL_PORT} → ${connection.host}:${connection.port}`,
  });
}

/**
 * The connecting steps of an RDP tab: the optional wake, the bastion's steps and the tunnel, then the
 * launch. The FreeRDP output is simulated by two info logs, after the tab is connected. The tab then stays
 * open until `session_close`.
 */
async function runRdp(
  session: LiveSession,
  state: MockState,
  connection: Connection,
  clientPath: string,
): Promise<void> {
  const { event } = scheduler(session);
  const label = clientPath.split("/").pop() ?? clientPath;

  // Wake the host first, if this direct connection asked for it (T29); never behind a bastion.
  if (connection.wol?.wakeBeforeConnect === true && connection.jumpHostId == null) {
    await step(event, "wake", connection.name);
  }

  const bastion = connection.jumpHostId
    ? state.connections.find((c) => c.id === connection.jumpHostId)
    : undefined;
  if (bastion) await tunnelSteps(event, state, connection, bastion);

  // The launch: the client's file name is the step label.
  await step(event, "launch", label);

  if (!sessions.has(session.id)) return;
  await event({ type: "connected" });
  await event({ type: "log", line: `[INFO][com.freerdp.core] connected to ${connection.host}` });
  await event({ type: "log", line: "[INFO][com.freerdp.client.sdl] desktop 1920x1080, 32 bpp" });

  // A client that leaves on its own writes an error, then closes with its exit status, and is forgotten.
  const exitStatus = MOCK_RDP_EXITS[label];
  if (exitStatus !== undefined) {
    await event({ type: "log", line: "[ERROR][com.freerdp.core] ERRCONNECT_LOGON_FAILURE" });
    await event({ type: "closed", reason: "processExited", exitStatus });
    sessions.delete(session.id);
  }
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
  if (sessions.has(sessionId)) throw validation("is already open");
  const connection = state.connections.find((c) => c.id === connectionId);
  if (!connection) throw notFound(`connection ${connectionId}`);
  if (connection.settings.protocol !== "rdp") throw validation("protocol: is not RDP");
  // The client must be a FreeRDP 3 binary; a forced wrong path is a missing client (comes back at once).
  const client = mockDetect(state);

  // An RDP tab has no terminal: its output callback is never called.
  const session: LiveSession = {
    id: sessionId,
    callbacks: { onEvent, onOutput: () => {} },
    prompt: "",
    line: "",
    cols: 0,
    rows: 0,
    timers: [],
  };
  sessions.set(sessionId, session);
  // The steps run in the background; the command answers at once, like the backend.
  void runRdp(session, state, connection, client.path);
  return { state, result: null };
}

export const rdpSessionHandlers: Record<string, Handler<Record<string, unknown>>> = {
  rdp_open: open,
};
