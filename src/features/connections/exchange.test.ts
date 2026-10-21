// T32: the toast text of an import, and the mock's fixed import file.
import { beforeEach, describe, expect, test } from "vitest";
import { ipc } from "@/lib/ipc";
import { resetMockBackend } from "@/lib/ipc-mock";
import { importSummary } from "./exchange";

beforeEach(() => {
  resetMockBackend();
});

describe("importSummary", () => {
  test("what was added, then only the counts that are not zero", () => {
    expect(importSummary({ added: 3, skipped: 0, invalid: 0, groupsCreated: 1 })).toBe(
      "3 connections added",
    );
    expect(importSummary({ added: 1, skipped: 2, invalid: 1, groupsCreated: 0 })).toBe(
      "1 connection added · 2 already here · 1 refused (invalid)",
    );
    expect(importSummary({ added: 0, skipped: 2, invalid: 0, groupsCreated: 0 })).toBe(
      "0 connections added · 2 already here",
    );
  });
});

describe("mock store_export and store_import", () => {
  test("the export counts every connection; the import adds once, then finds it already here", async () => {
    const { connections } = await ipc.storeLoad();
    expect(await ipc.storeExport("/home/user/tunl-connections.json")).toBe(connections.length);

    const first = await ipc.storeImport("/home/user/tunl-connections.json");
    expect(first).toEqual({ added: 1, skipped: 1, invalid: 0, groupsCreated: 1 });
    const after = await ipc.storeLoad();
    const backup = after.connections.find((c) => c.name === "backup-01");
    expect(after.groups.find((g) => g.id === backup?.groupId)?.name).toBe("Backups");

    const second = await ipc.storeImport("/home/user/tunl-connections.json");
    expect(second).toEqual({ added: 0, skipped: 2, invalid: 0, groupsCreated: 0 });
  });
});
