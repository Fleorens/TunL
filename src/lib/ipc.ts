import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow, type Window } from "@tauri-apps/api/window";
import type { AppInfo } from "@/bindings/AppInfo";
import type { Connection } from "@/bindings/Connection";
import type { ConnectionInput } from "@/bindings/ConnectionInput";
import type { ConnectionTemplates } from "@/bindings/ConnectionTemplates";
import type { Group } from "@/bindings/Group";
import type { GroupInput } from "@/bindings/GroupInput";
import type { ImportPreview } from "@/bindings/ImportPreview";
import type { ImportReport } from "@/bindings/ImportReport";
import type { KnownHostEntry } from "@/bindings/KnownHostEntry";
import type { ProbeResult } from "@/bindings/ProbeResult";
import type { PromptAnswer } from "@/bindings/PromptAnswer";
import type { RdpClient } from "@/bindings/RdpClient";
import type { RemoteEntry } from "@/bindings/RemoteEntry";
import type { SecretKind } from "@/bindings/SecretKind";
import type { SessionEvent } from "@/bindings/SessionEvent";
import type { SessionTarget } from "@/bindings/SessionTarget";
import type { Settings } from "@/bindings/Settings";
import type { StoreSnapshot } from "@/bindings/StoreSnapshot";
import type { TitleBarMode } from "@/bindings/TitleBarMode";
import type { TransferEvent } from "@/bindings/TransferEvent";
import type { WindowChrome } from "@/bindings/WindowChrome";
import { mockInvoke } from "./ipc-mock";

type Args = Record<string, unknown>;

/** False inside the Tauri window; true in a plain browser (`npm run dev`) and in tests. */
export const isMockBackend = !isTauri();

function call<T>(command: string, args?: Args): Promise<T> {
  return isMockBackend ? mockInvoke<T>(command, args) : invoke<T>(command, args);
}

/**
 * Run a window action on the real window inside Tauri only (`getCurrentWindow()` throws outside the window, like
 * `Channel`); outside it, the mock handles `command`. The three window buttons (T35) go through here.
 */
function runOnWindow(command: string, run: (appWindow: Window) => Promise<void>): Promise<void> {
  return isMockBackend ? mockInvoke<void>(command) : run(getCurrentWindow());
}

/** Where a shell session reports back to the UI: its events, and its shell bytes. */
export interface SessionCallbacks {
  onEvent: (event: SessionEvent) => void;
  onOutput: (bytes: Uint8Array) => void;
}

/** A terminal size, in columns and rows. */
export interface TerminalSize {
  cols: number;
  rows: number;
}

/**
 * The two Tauri `Channel`s the backend reads keystrokes and output through (only built inside Tauri: a
 * `Channel` cannot be constructed outside the window). With the mock, the callbacks pass through as-is.
 */
function sessionChannels(callbacks: SessionCallbacks) {
  return isMockBackend
    ? { onEvent: callbacks.onEvent, onOutput: callbacks.onOutput }
    : {
        onEvent: new Channel<SessionEvent>(callbacks.onEvent),
        onOutput: new Channel<ArrayBuffer>((buffer) => callbacks.onOutput(new Uint8Array(buffer))),
      };
}

/** A transfer's events back to the UI: the callback for the mock, one `Channel` in Tauri. */
function transferChannel(onEvent: (event: TransferEvent) => void) {
  return isMockBackend ? onEvent : new Channel<TransferEvent>(onEvent);
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

  // Export and import (T32): the whole store as one JSON file, without secrets (S1).
  storeExport: (path: string) => call<number>("store_export", { path }),
  storeImport: (path: string) => call<ImportReport>("store_import", { path }),

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

  // Window (T35): drop (or keep) the decorations for the chosen title bar, and the window buttons.
  windowApplyTitleBar: (mode: TitleBarMode) =>
    call<WindowChrome>("window_apply_title_bar", { mode }),
  windowMinimize: () => runOnWindow("window_minimize", (appWindow) => appWindow.minimize()),
  windowToggleMaximize: () =>
    runOnWindow("window_toggle_maximize", (appWindow) => appWindow.toggleMaximize()),
  windowClose: () => runOnWindow("window_close", (appWindow) => appWindow.close()),

  // Import: preview a `~/.ssh/config`, then apply the selected candidates.
  importSshConfigPreview: (path: string | null) =>
    call<ImportPreview>("import_ssh_config_preview", { path }),
  importSshConfigApply: (path: string | null, aliases: string[], groupId: string | null) =>
    call<StoreSnapshot>("import_ssh_config_apply", { path, aliases, groupId }),

  // Secrets: write, test presence, delete — never read (S2).
  secretSet: (connectionId: string, kind: SecretKind, value: string) =>
    call<void>("secret_set", { connectionId, kind, value }),
  secretHas: (connectionId: string, kind: SecretKind) =>
    call<boolean>("secret_has", { connectionId, kind }),
  secretDelete: (connectionId: string, kind: SecretKind) =>
    call<void>("secret_delete", { connectionId, kind }),

  // Sessions (T19): open a shell, write to it, resize it, close it. The events and bytes come back
  // through the two `Channel`s built by `sessionChannels`.
  sshOpen: (
    sessionId: string,
    target: SessionTarget,
    size: TerminalSize,
    callbacks: SessionCallbacks,
  ) =>
    call<void>("ssh_open", {
      sessionId,
      target,
      cols: size.cols,
      rows: size.rows,
      ...sessionChannels(callbacks),
    }),
  sshWrite: (sessionId: string, data: string) => call<void>("ssh_write", { sessionId, data }),
  sshResize: (sessionId: string, size: TerminalSize) =>
    call<void>("ssh_resize", { sessionId, cols: size.cols, rows: size.rows }),
  // Ack output the terminal finished rendering, so a huge shell output does not freeze it (T50).
  sshAck: (sessionId: string, bytes: number) => call<void>("ssh_ack", { sessionId, bytes }),
  sessionClose: (sessionId: string) => call<void>("session_close", { sessionId }),

  // SFTP (T24): open a tab (its events come back through one `Channel`, the callback itself with the
  // mock), then work on its remote files by tab id.
  sftpOpen: (sessionId: string, target: SessionTarget, onEvent: (event: SessionEvent) => void) =>
    call<void>("sftp_open", {
      sessionId,
      target,
      onEvent: isMockBackend ? onEvent : new Channel<SessionEvent>(onEvent),
    }),
  sftpRealpath: (sessionId: string, path: string) =>
    call<string>("sftp_realpath", { sessionId, path }),
  sftpList: (sessionId: string, path: string) =>
    call<RemoteEntry[]>("sftp_list", { sessionId, path }),
  sftpMkdir: (sessionId: string, path: string) => call<void>("sftp_mkdir", { sessionId, path }),
  sftpRename: (sessionId: string, from: string, to: string) =>
    call<void>("sftp_rename", { sessionId, from, to }),
  sftpCount: (sessionId: string, path: string) => call<number>("sftp_count", { sessionId, path }),
  sftpRemove: (sessionId: string, path: string) => call<void>("sftp_remove", { sessionId, path }),
  sftpChmod: (sessionId: string, path: string, mode: number) =>
    call<void>("sftp_chmod", { sessionId, path, mode }),

  // Transfers (T26): download a remote file, upload a local one, cancel one. The steps and the end
  // come back through one `Channel` (built by `transferChannel`), the callback itself with the mock.
  sftpDownload: (
    sessionId: string,
    transferId: string,
    remotePath: string,
    onEvent: (event: TransferEvent) => void,
  ) =>
    call<void>("sftp_download", {
      sessionId,
      transferId,
      remotePath,
      onEvent: transferChannel(onEvent),
    }),
  sftpUpload: (
    sessionId: string,
    transferId: string,
    localPath: string,
    remoteDir: string,
    onEvent: (event: TransferEvent) => void,
  ) =>
    call<void>("sftp_upload", {
      sessionId,
      transferId,
      localPath,
      remoteDir,
      onEvent: transferChannel(onEvent),
    }),
  transferCancel: (transferId: string) => call<void>("transfer_cancel", { transferId }),

  // Prompts (T17): answer the question the backend posed, and forget a known host.
  promptAnswer: (id: string, answer: PromptAnswer) => call<void>("prompt_answer", { id, answer }),
  knownHostRemove: (host: string, port: number) =>
    call<number>("known_host_remove", { host, port }),

  // Known hosts (T31b): the hosts TunL trusts, as the Settings tab lists them.
  knownHostsList: () => call<KnownHostEntry[]>("known_hosts_list"),

  // RDP (T27): the FreeRDP 3 client TunL would launch with, or none.
  rdpDetect: () => call<RdpClient>("rdp_detect"),

  // RDP (T28): open a tab (its events come back through one `Channel`, the callback itself with the
  // mock), then run it in the background.
  rdpOpen: (sessionId: string, connectionId: string, onEvent: (event: SessionEvent) => void) =>
    call<void>("rdp_open", {
      sessionId,
      connectionId,
      onEvent: isMockBackend ? onEvent : new Channel<SessionEvent>(onEvent),
    }),

  // Wake-on-LAN (T29): send a connection's magic packet, no wait.
  wolWake: (id: string) => call<void>("wol_wake", { id }),

  // Reachability (T30): probe a set of connections (TCP connect only), in the order given.
  probeCheck: (ids: string[]) => call<ProbeResult[]>("probe_check", { ids }),
};
