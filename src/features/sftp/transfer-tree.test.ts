// T55: a folder is one transfer: its file count and skipped links come with `counted`, and it can be downloaded.
import { describe, expect, test } from "vitest";
import type { RemoteEntry } from "@/bindings/RemoteEntry";
import { isDownloadable } from "./sftp-model";
import { applyTransferEvent, newTransfer } from "./transfer-model";

function entry(kind: RemoteEntry["kind"], targetKind?: RemoteEntry["kind"]): RemoteEntry {
  return {
    name: "x",
    path: "/h/x",
    kind,
    size: 0,
    modifiedAt: null,
    permissions: 0o755,
    hidden: false,
    targetKind,
  };
}

describe("folder transfers", () => {
  test("counted sets the files, the skipped links and the total", () => {
    const start = newTransfer("t-1", "run-1", "download", "photos");
    expect(start).toMatchObject({ files: null, skipped: 0 });
    const counted = applyTransferEvent(start, {
      type: "counted",
      files: 2,
      bytes: 8,
      skipped: 1,
    });
    expect(counted).toMatchObject({ files: 2, skipped: 1, total: 8, status: "running" });
    expect(start.files).toBeNull();
  });

  test("a folder can be downloaded, a link to a folder cannot", () => {
    expect(isDownloadable(entry("dir"))).toBe(true);
    expect(isDownloadable(entry("file"))).toBe(true);
    expect(isDownloadable(entry("symlink", "file"))).toBe(true);
    expect(isDownloadable(entry("symlink", "dir"))).toBe(false);
    expect(isDownloadable(entry("symlink"))).toBe(false);
  });
});
