// T26: the mock's transfers, which the panel is built against.
import { beforeEach, describe, expect, test } from "vitest";
import type { TransferEvent } from "@/bindings/TransferEvent";
import { ipc } from "@/lib/ipc";
import { resetMockBackend } from "@/lib/ipc-mock";
import { MOCK_IDS } from "@/lib/mock/data";

beforeEach(() => {
  resetMockBackend();
});

async function openTab(): Promise<string> {
  const id = crypto.randomUUID();
  await new Promise<void>((resolve) => {
    void ipc.sftpOpen(id, { type: "saved", connectionId: MOCK_IDS.nas }, (event) => {
      if (event.type === "connected") resolve();
    });
  });
  return id;
}

/** Start a transfer and collect its events until the last one. */
function collect(start: (onEvent: (e: TransferEvent) => void) => Promise<void>) {
  return new Promise<TransferEvent[]>((resolve) => {
    const events: TransferEvent[] = [];
    void start((event) => {
      events.push(event);
      if (event.type !== "progress") resolve(events);
    });
  });
}

describe("mock transfers", () => {
  test("a download reports progress, then where it landed; never over an earlier one", async () => {
    const tab = await openTab();
    const first = await collect((on) =>
      ipc.sftpDownload(tab, crypto.randomUUID(), "/home/admin/notes.txt", on),
    );
    expect(first[0]).toMatchObject({ type: "progress", total: 512 });
    expect(first.at(-1)).toEqual({ type: "done", path: "/home/user/Downloads/notes.txt" });
    const second = await collect((on) =>
      ipc.sftpDownload(tab, crypto.randomUUID(), "/home/admin/notes.txt", on),
    );
    expect(second.at(-1)).toEqual({ type: "done", path: "/home/user/Downloads/notes (1).txt" });
  });

  test("a missing file fails as not found", async () => {
    const tab = await openTab();
    const events = await collect((on) =>
      ipc.sftpDownload(tab, crypto.randomUUID(), "/home/admin/nope", on),
    );
    expect(events.at(-1)).toMatchObject({ type: "failed", error: { kind: "notFound" } });
  });

  test("an upload lands in the folder, beside an existing file of the same name", async () => {
    const tab = await openTab();
    const one = await collect((on) =>
      ipc.sftpUpload(tab, crypto.randomUUID(), "/home/me/notes.txt", "/home/admin", on),
    );
    expect(one.at(-1)).toEqual({ type: "done", path: "/home/admin/notes (1).txt" });
    const names = (await ipc.sftpList(tab, "/home/admin")).map((e) => e.name);
    expect(names).toContain("notes (1).txt");
  });

  test("a cancelled transfer ends with cancelled", async () => {
    const tab = await openTab();
    const id = crypto.randomUUID();
    const events = await collect(async (on) => {
      await ipc.sftpDownload(tab, id, "/home/admin/backup.tar.gz", on);
      await ipc.transferCancel(id);
    });
    expect(events.at(-1)).toEqual({ type: "cancelled" });
  });
});
