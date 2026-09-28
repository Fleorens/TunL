import type { AppError } from "@/bindings/AppError";
import type { AppInfo } from "@/bindings/AppInfo";
import { connectionHandlers } from "./mock/connections";
import type { Handler, MockState } from "./mock/data";
import { freshState, TEMPLATES } from "./mock/data";
import { groupHandlers } from "./mock/groups";
import { secretHandlers } from "./mock/secrets";
import { settingsHandlers } from "./mock/settings";

type Args = Record<string, unknown> | undefined;

const MOCK_LATENCY_MS = 120;

const MOCK_APP_INFO: AppInfo = {
  name: "TunL",
  version: "0.1.0-mock",
  identifier: "io.github.fleorens.TunL",
  tauriVersion: "mock",
  configDir: "~/.config/io.github.fleorens.TunL",
  dataDir: "~/.local/share/io.github.fleorens.TunL",
  logDir: "~/.local/share/io.github.fleorens.TunL/logs",
  startedAtMs: Date.now(),
};

/** The mock's whole in-memory state, replaced (never mutated) on every mutation. */
let state: MockState = freshState();

/** A failure scheduled for the next call to a given command, if any. */
let pendingFailure: { command: string; error: AppError } | null = null;

const HANDLERS: Record<string, Handler> = {
  app_info: (current) => ({ state: current, result: MOCK_APP_INFO }),
  store_load: (current) => ({
    state: current,
    result: {
      groups: current.groups,
      connections: current.connections,
      quarantined: current.quarantined,
    },
  }),
  connection_templates: (current) => ({ state: current, result: structuredClone(TEMPLATES) }),
  ...connectionHandlers,
  ...groupHandlers,
  ...secretHandlers,
  ...settingsHandlers,
};

/** The commands the mock answers (checked against `ipc.ts` by `ipc-contract.test.ts`). */
export const MOCK_COMMANDS: readonly string[] = Object.keys(HANDLERS);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Reject the next call to `command` with `error`, then return to normal (one shot). */
export function failNextCall(command: string, error: AppError): void {
  pendingFailure = { command, error };
}

/** Reset the state to the demo data and clear any scheduled failure. */
export function resetMockBackend(): void {
  state = freshState();
  pendingFailure = null;
}

/** Browser-only fake backend used by `npm run dev` outside Tauri, and by the tests. */
export async function mockInvoke<T>(command: string, args?: Args): Promise<T> {
  await delay(import.meta.env.MODE === "test" ? 0 : MOCK_LATENCY_MS);

  if (pendingFailure?.command === command) {
    const error = pendingFailure.error;
    pendingFailure = null;
    throw error;
  }

  const handler = HANDLERS[command];
  if (!handler) {
    const error: AppError = {
      kind: "internal",
      message: `mock backend: command "${command}" is not implemented`,
      detail: null,
    };
    throw error;
  }

  const { state: next, result } = handler(state, args ?? {});
  state = next;
  return result as T;
}
