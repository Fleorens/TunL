// SFTP transfers: the list of in-flight and finished transfers, and the calls that start, cancel and
// clear them. The events come back through a callback (built as a `Channel` only in Tauri, T26); this
// store never builds one itself. Pure store: every state update builds a new value, never mutates.
import { create } from "zustand";
import type { RemoteEntry } from "@/bindings/RemoteEntry";
import type { TransferEvent } from "@/bindings/TransferEvent";
import { notifyError, toAppError } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import { applyTransferEvent, newTransfer, type Transfer } from "./transfer-model";

/** A transfer's id, and the transfer itself, keyed by id. */
type Transfers = Record<string, Transfer>;

interface TransfersState {
  transfers: Transfers;

  /** Start a download of `entry` on `sessionId`, and follow its events until it ends. */
  download: (sessionId: string, entry: RemoteEntry) => Promise<void>;
  /** Start an upload of `localPath` to `remoteDir`; call `onDone` when it reaches a final state (T26b). */
  upload: (
    sessionId: string,
    localPath: string,
    remoteDir: string,
    onDone?: (transfer: Transfer) => void,
  ) => Promise<void>;
  /** Cancel the transfer by id (a no-op when it is already finished). */
  cancel: (id: string) => Promise<void>;
  /** Forget every finished transfer of `sessionId`. */
  clearFinished: (sessionId: string) => void;
}

type SetState = (update: (state: TransfersState) => Partial<TransfersState>) => void;

/**
 * Build the event handler of transfer `id`: apply each event to the stored transfer, ignore events of a
 * transfer already cleared, and call `onDone` once, when it goes from `running` to a final state.
 */
function eventApplier(
  set: SetState,
  get: () => TransfersState,
  id: string,
  onDone?: (transfer: Transfer) => void,
): (event: TransferEvent) => void {
  return (event) => {
    const before = get().transfers[id];
    if (!before) return;
    const next = applyTransferEvent(before, event);
    if (next === before) return;
    set((state) => ({ transfers: { ...state.transfers, [id]: next } }));
    if (before.status === "running" && next.status !== "running") onDone?.(next);
  };
}

export const useTransfers = create<TransfersState>()((set, get) => ({
  transfers: {},

  async download(sessionId, entry) {
    const id = crypto.randomUUID();
    const initial = newTransfer(id, sessionId, "download", entry.name);
    set((state) => ({ transfers: { ...state.transfers, [id]: initial } }));

    const apply = eventApplier(set, get, id);

    try {
      await ipc.sftpDownload(sessionId, id, entry.path, apply);
    } catch (error) {
      // An ipc rejection becomes a `failed` event of the transfer, so the panel never leaves it hanging.
      apply({ type: "failed", error: toAppError(error) });
    }
  },

  async upload(sessionId, localPath, remoteDir, onDone) {
    const id = crypto.randomUUID();
    const name = localPath.slice(localPath.lastIndexOf("/") + 1);
    const initial = newTransfer(id, sessionId, "upload", name);
    set((state) => ({ transfers: { ...state.transfers, [id]: initial } }));

    const apply = eventApplier(set, get, id, onDone);

    try {
      await ipc.sftpUpload(sessionId, id, localPath, remoteDir, apply);
    } catch (error) {
      apply({ type: "failed", error: toAppError(error) });
    }
  },

  async cancel(id) {
    if (get().transfers[id]?.status !== "running") return;
    try {
      await ipc.transferCancel(id);
    } catch (error) {
      notifyError(error);
    }
  },

  clearFinished(sessionId) {
    set((state) => {
      const next: Transfers = {};
      for (const [key, transfer] of Object.entries(state.transfers)) {
        if (transfer.sessionId === sessionId && transfer.status !== "running") continue;
        next[key] = transfer;
      }
      return { transfers: next };
    });
  },
}));
