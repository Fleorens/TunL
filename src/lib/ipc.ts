import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AppInfo } from "@/bindings/AppInfo";
import type { Connection } from "@/bindings/Connection";
import type { ConnectionInput } from "@/bindings/ConnectionInput";
import type { ConnectionTemplates } from "@/bindings/ConnectionTemplates";
import type { Group } from "@/bindings/Group";
import type { GroupInput } from "@/bindings/GroupInput";
import type { Settings } from "@/bindings/Settings";
import type { StoreSnapshot } from "@/bindings/StoreSnapshot";
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

  // Store
  storeLoad: () => call<StoreSnapshot>("store_load"),
  connectionTemplates: () => call<ConnectionTemplates>("connection_templates"),

  // Connections
  connectionCreate: (input: ConnectionInput) => call<Connection>("connection_create", { input }),
  connectionUpdate: (id: string, input: ConnectionInput) =>
    call<Connection>("connection_update", { id, input }),
  connectionDuplicate: (id: string) => call<Connection>("connection_duplicate", { id }),
  connectionDelete: (id: string) => call<void>("connection_delete", { id }),
  connectionSetFavorite: (id: string, favorite: boolean) =>
    call<Connection>("connection_set_favorite", { id, favorite }),
  connectionTouch: (id: string) => call<Connection>("connection_touch", { id }),

  // Groups
  groupCreate: (input: GroupInput) => call<Group>("group_create", { input }),
  groupUpdate: (id: string, input: GroupInput) => call<Group>("group_update", { id, input }),
  groupDelete: (id: string) => call<StoreSnapshot>("group_delete", { id }),
  groupReorder: (ids: string[]) => call<Group[]>("group_reorder", { ids }),

  // Settings
  settingsGet: () => call<Settings>("settings_get"),
  settingsUpdate: (settings: Settings) => call<Settings>("settings_update", { settings }),
};
