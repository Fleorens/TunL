// T26: a transfer's life, as the panel shows it.
import { describe, expect, test } from "vitest";
import { applyTransferEvent, newTransfer, percentOf } from "./transfer-model";

const start = newTransfer("t-1", "run-1", "download", "backup.tar.gz");

describe("transfers", () => {
  test("a new transfer runs, with nothing transferred yet", () => {
    expect(start).toMatchObject({ status: "running", transferred: 0, total: null, path: null });
    expect(percentOf(start)).toBeNull();
  });

  test("progress, then done", () => {
    const half = applyTransferEvent(start, {
      type: "progress",
      transferred: 50,
      total: 200,
      bytesPerSec: 1000,
    });
    expect(percentOf(half)).toBe(25);
    expect(half.bytesPerSec).toBe(1000);
    const done = applyTransferEvent(half, {
      type: "done",
      path: "/home/me/Downloads/backup.tar.gz",
    });
    expect(done.status).toBe("done");
    expect(done.path).toBe("/home/me/Downloads/backup.tar.gz");
    expect(percentOf(done)).toBe(100);
    expect(start.transferred).toBe(0);
  });

  test("failed and cancelled are final: a late event changes nothing", () => {
    const error = { kind: "notFound" as const, message: "/srv/x", detail: null };
    const failed = applyTransferEvent(start, { type: "failed", error });
    expect(failed).toMatchObject({ status: "failed", error });
    const cancelled = applyTransferEvent(start, { type: "cancelled" });
    expect(cancelled.status).toBe("cancelled");
    const late = applyTransferEvent(cancelled, {
      type: "progress",
      transferred: 9,
      total: 10,
      bytesPerSec: 1,
    });
    expect(late).toBe(cancelled);
  });

  test("an empty file is not a division by zero", () => {
    const empty = applyTransferEvent(start, {
      type: "progress",
      transferred: 0,
      total: 0,
      bytesPerSec: 0,
    });
    expect(percentOf(empty)).toBeNull();
  });
});
