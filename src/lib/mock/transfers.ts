// Mock handlers for the transfer commands (T26): download, upload, cancel. A transfer runs in the
// background, emitting progress steps spaced by MOCK_STEP_MS and ending with exactly one final event.
// A destination name never clobbers an already-downloaded file (download) or an existing remote file (upload).
import type { AppError } from "@/bindings/AppError";
import type { TransferEvent } from "@/bindings/TransferEvent";
import type { Handler } from "./data";
import { arg } from "./data";
import { mockRemoteNames, mockRemoteNode, mockRemoteTree, mockRemoteWrite } from "./sftp";
import type { MockNode } from "./sftp-fs";

/** The local folder a download lands in. */
export const MOCK_DOWNLOAD_DIR = "/home/user/Downloads";

/** One step every MOCK_STEP_MS (5 ms in tests, not 0: a big file still runs when a test cancels it). */
const MOCK_STEP_MS = import.meta.env.MODE === "test" ? 5 : 150;
/** The throughput the UI shows: 12.4 MiB/s. */
const BYTES_PER_SEC = Math.round(12.4 * 1024 * 1024);
/** One progress step per 20 MiB, between 1 and 40 steps. */
const STEP_BYTES = 20 * 1024 * 1024;
const MAX_STEPS = 40;

/** An in-flight transfer, by id, so a cancel can stop its steps. */
interface ActiveTransfer {
  timers: Array<ReturnType<typeof setTimeout>>;
  cancelled: boolean;
  onEvent: (event: TransferEvent) => void;
}

/** Every in-flight transfer, by transfer id. */
const active = new Map<string, ActiveTransfer>();

/** The basenames already downloaded, so a second download of the same file gets a free name. */
const downloaded = new Set<string>();

function notFound(path: string): AppError {
  return { kind: "notFound", message: path, detail: null };
}

/** The base name of a path, without its directory. */
function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** `base`, or `base (n)` before its extension when `taken` already holds it. */
function freeName(base: string, taken: (name: string) => boolean): string {
  if (!taken(base)) return base;
  let n = 1;
  while (taken(suffixed(base, n))) n++;
  return suffixed(base, n);
}

/** Insert ` (n)` before the extension: `report (1).pdf`, `archive.tar (2).gz`, `notes (3)`, `.bashrc (1)`. */
function suffixed(base: string, n: number): string {
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return `${base} (${n})`;
  return `${base.slice(0, dot)} (${n})${base.slice(dot)}`;
}

/** Emit the progress steps for a `total`, stopping early if the transfer is cancelled. */
async function runSteps(
  total: number,
  onEvent: (event: TransferEvent) => void,
  reg: ActiveTransfer,
): Promise<void> {
  const steps = Math.min(MAX_STEPS, Math.max(1, Math.ceil(total / STEP_BYTES)));
  for (let i = 1; i <= steps; i++) {
    if (reg.cancelled) return;
    onEvent({
      type: "progress",
      transferred: Math.min(total, i * STEP_BYTES),
      total,
      bytesPerSec: BYTES_PER_SEC,
    });
    if (i < steps) {
      await new Promise<void>((resolve) => {
        reg.timers.push(setTimeout(resolve, MOCK_STEP_MS));
      });
      if (reg.cancelled) return;
    }
  }
}

async function runDownload(
  transferId: string,
  remotePath: string,
  node: MockNode | undefined,
  onEvent: (event: TransferEvent) => void,
): Promise<void> {
  const reg: ActiveTransfer = { timers: [], cancelled: false, onEvent };
  active.set(transferId, reg);
  // A missing path or a directory fails as not found; the tab check already happened in the handler.
  if (node === undefined || node.kind !== "file") {
    active.delete(transferId);
    onEvent({ type: "failed", error: notFound(remotePath) });
    return;
  }
  await runSteps(node.size, onEvent, reg);
  if (reg.cancelled) return;
  finishDownload(transferId, remotePath, onEvent);
}

/** A folder downloads whole (T55): `counted` (its files and links), the steps over the total, then `done`. */
async function runFolderDownload(
  transferId: string,
  remotePath: string,
  nodes: MockNode[],
  onEvent: (event: TransferEvent) => void,
): Promise<void> {
  const reg: ActiveTransfer = { timers: [], cancelled: false, onEvent };
  active.set(transferId, reg);
  const files = nodes.filter((node) => node.kind === "file");
  const bytes = files.reduce((sum, node) => sum + node.size, 0);
  const skipped = nodes.filter((node) => node.kind === "symlink" || node.kind === "other").length;
  onEvent({ type: "counted", files: files.length, bytes, skipped });
  await runSteps(bytes, onEvent, reg);
  if (reg.cancelled) return;
  finishDownload(transferId, remotePath, onEvent);
}

/** The `done` of a download, to a free name in MOCK_DOWNLOAD_DIR. */
function finishDownload(
  transferId: string,
  remotePath: string,
  onEvent: (event: TransferEvent) => void,
): void {
  const destName = freeName(nameOf(remotePath), (name) => downloaded.has(name));
  const dest = `${MOCK_DOWNLOAD_DIR}/${destName}`;
  active.delete(transferId);
  onEvent({ type: "done", path: dest });
  downloaded.add(destName);
}

async function runUpload(
  transferId: string,
  localPath: string,
  remoteDir: string,
  names: string[],
  onEvent: (event: TransferEvent) => void,
): Promise<void> {
  const reg: ActiveTransfer = { timers: [], cancelled: false, onEvent };
  active.set(transferId, reg);
  // The uploaded file's size is fictitious; it only sets the progress total. A `.iso` is 100 MiB
  // (five steps): an upload that long gives a test time to browse elsewhere mid-flight.
  const size = nameOf(localPath).endsWith(".iso") ? 100 * 1024 * 1024 : 1024;
  await runSteps(size, onEvent, reg);
  if (reg.cancelled) return;
  const destName = freeName(nameOf(localPath), (name) => names.includes(name));
  const dest = remoteDir.endsWith("/") ? `${remoteDir}${destName}` : `${remoteDir}/${destName}`;
  mockRemoteWrite(dest, size);
  active.delete(transferId);
  onEvent({ type: "done", path: dest });
}

export const transferHandlers: Record<string, Handler<Record<string, unknown>>> = {
  sftp_download: (state, args) => {
    const { sessionId, transferId, remotePath, onEvent } = arg<{
      sessionId: string;
      transferId: string;
      remotePath: string;
      onEvent: (event: TransferEvent) => void;
    }>(args);
    // Throws `notFound` when the tab is not connected (like the other tab commands); `undefined` when
    // the file is absent, which `runDownload` reports as a `failed` event.
    // A link downloads like its target (T48): follow it once, so a link to a file downloads a file and a
    // broken link (no target) keeps the symlink node and fails as not found.
    const node = mockRemoteNode(sessionId, remotePath);
    // A folder (never a link to one) downloads whole (T55).
    if (node?.kind === "dir") {
      void runFolderDownload(
        transferId,
        remotePath,
        mockRemoteTree(sessionId, remotePath),
        onEvent,
      );
      return { state, result: null };
    }
    const resolved =
      node?.kind === "symlink" && node.target
        ? (mockRemoteNode(sessionId, node.target) ?? node)
        : node;
    void runDownload(transferId, remotePath, resolved, onEvent);
    return { state, result: null };
  },
  sftp_upload: (state, args) => {
    const { sessionId, transferId, localPath, remoteDir, onEvent } = arg<{
      sessionId: string;
      transferId: string;
      localPath: string;
      remoteDir: string;
      onEvent: (event: TransferEvent) => void;
    }>(args);
    const names = mockRemoteNames(sessionId, remoteDir);
    void runUpload(transferId, localPath, remoteDir, names, onEvent);
    return { state, result: null };
  },
  transfer_cancel: (state, args) => {
    const { transferId } = arg<{ transferId: string }>(args);
    const reg = active.get(transferId);
    // Cancelling an unknown or finished transfer is not an error.
    if (reg && !reg.cancelled) {
      reg.cancelled = true;
      for (const timer of reg.timers) clearTimeout(timer);
      active.delete(transferId);
      reg.onEvent({ type: "cancelled" });
    }
    return { state, result: null };
  },
};

/** Cancel every in-flight transfer and forget the downloaded names, for `resetMockBackend()`. */
export function resetMockTransfers(): void {
  for (const reg of active.values()) {
    reg.cancelled = true;
    for (const timer of reg.timers) clearTimeout(timer);
  }
  active.clear();
  downloaded.clear();
}
