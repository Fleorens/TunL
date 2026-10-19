// A transfer's pure model: its life from start to a final state, exactly as the panel reads it.
// Pure: every function returns a new value, never mutates its input (docs/01 §6.1).
import type { AppError } from "@/bindings/AppError";
import type { TransferEvent } from "@/bindings/TransferEvent";

/** A download or an upload (T26b owns the upload side). */
export type TransferDirection = "download" | "upload";
/** A running transfer, or one that reached a final state and will not move again. */
export type TransferStatus = "running" | "done" | "failed" | "cancelled";

/** A transfer as the panel shows it: progress toward a total, and where it ended. */
export interface Transfer {
  id: string;
  sessionId: string;
  direction: TransferDirection;
  /** The file name, remote for a download, local for an upload. */
  name: string;
  transferred: number;
  total: number | null;
  bytesPerSec: number;
  status: TransferStatus;
  error: AppError | null;
  /** Where the file ended up, once the transfer is done. */
  path: string | null;
}

/** A brand-new transfer, running, with nothing transferred yet. */
export function newTransfer(
  id: string,
  sessionId: string,
  direction: TransferDirection,
  name: string,
): Transfer {
  return {
    id,
    sessionId,
    direction,
    name,
    transferred: 0,
    total: null,
    bytesPerSec: 0,
    status: "running",
    error: null,
    path: null,
  };
}

/**
 * The next transfer for an event, without touching `t`.
 *
 * A running transfer advances (progress) or reaches a final state (done / failed / cancelled). A
 * transfer already finished is returned **as-is**: a late event changes nothing, so the panel keeps
 * the exact same object (identity preserved).
 */
export function applyTransferEvent(t: Transfer, event: TransferEvent): Transfer {
  if (t.status !== "running") return t;

  switch (event.type) {
    case "progress":
      return {
        ...t,
        transferred: event.transferred,
        total: event.total,
        bytesPerSec: event.bytesPerSec,
      };
    case "done":
      return { ...t, status: "done", path: event.path };
    case "failed":
      return { ...t, status: "failed", error: event.error };
    case "cancelled":
      return { ...t, status: "cancelled" };
  }
}

/**
 * The progress as a percentage, or `null` when it cannot be shown.
 *
 * A done transfer is 100%. When the total is unknown or zero (an empty file), there is no percentage
 * to avoid a division by zero. Otherwise the floor of the ratio, so the bar always moves up.
 */
export function percentOf(t: Transfer): number | null {
  if (t.status === "done") return 100;
  const total = t.total;
  if (total == null || total === 0) return null;
  return Math.floor((t.transferred / total) * 100);
}
