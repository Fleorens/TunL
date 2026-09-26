import type { AppError } from "@/bindings/AppError";
import type { AppInfo } from "@/bindings/AppInfo";

type Args = Record<string, unknown> | undefined;
type Handler = (args: Args) => unknown;

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

/** One entry per Rust command (same snake_case name). Keep in sync with lib/ipc.ts. */
const HANDLERS: Readonly<Record<string, Handler>> = {
  app_info: () => MOCK_APP_INFO,
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Browser-only fake backend used by `npm run dev` outside Tauri, and by the tests. */
export async function mockInvoke<T>(command: string, args?: Args): Promise<T> {
  await delay(import.meta.env.MODE === "test" ? 0 : MOCK_LATENCY_MS);
  const handler = HANDLERS[command];
  if (!handler) {
    const error: AppError = {
      kind: "internal",
      message: `mock backend: command "${command}" is not implemented`,
      detail: null,
    };
    throw error;
  }
  return handler(args) as T;
}
