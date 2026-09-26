import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AppInfo } from "@/bindings/AppInfo";
import { mockInvoke } from "./ipc-mock";

type Args = Record<string, unknown>;

/** False inside the Tauri window; true in a plain browser (`npm run dev`) and in tests. */
export const isMockBackend = !isTauri();

function call<T>(command: string, args?: Args): Promise<T> {
  return isMockBackend ? mockInvoke<T>(command, args) : invoke<T>(command, args);
}

/**
 * The ONLY door to the Rust backend: one typed function per command (docs/01-architecture.md §4.3).
 * Every call rejects with an AppError-shaped value; normalize it with `toAppError`.
 */
export const ipc = {
  appInfo: () => call<AppInfo>("app_info"),
};
