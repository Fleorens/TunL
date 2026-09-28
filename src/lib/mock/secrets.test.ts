import { beforeEach, describe, expect, test } from "vitest";
import { toAppError } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import { failNextCall, resetMockBackend } from "@/lib/ipc-mock";
import { MOCK_IDS } from "@/lib/mock/data";

beforeEach(() => {
  resetMockBackend();
});

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return toAppError(error);
  }
  throw new Error("expected a rejection");
}

describe("mock secrets", () => {
  test("the demo data has two saved secrets", async () => {
    expect(await ipc.secretHas(MOCK_IDS.ad01, "password")).toBe(true);
    expect(await ipc.secretHas(MOCK_IDS.dbProd, "passphrase")).toBe(true);
    expect(await ipc.secretHas(MOCK_IDS.web01, "password")).toBe(false);
  });

  test("set, has, delete", async () => {
    await ipc.secretSet(MOCK_IDS.web01, "password", "hunter2");
    expect(await ipc.secretHas(MOCK_IDS.web01, "password")).toBe(true);
    await ipc.secretDelete(MOCK_IDS.web01, "password");
    expect(await ipc.secretHas(MOCK_IDS.web01, "password")).toBe(false);
  });

  test("rejects an empty value and an unknown connection", async () => {
    expect((await rejection(ipc.secretSet(MOCK_IDS.web01, "password", ""))).kind).toBe(
      "validation",
    );
    const unknown = "b2000000-0000-4000-8000-000000000000";
    expect((await rejection(ipc.secretSet(unknown, "password", "x"))).kind).toBe("notFound");
  });

  test("the value is never kept, even by the mock", async () => {
    await ipc.secretSet(MOCK_IDS.web01, "password", "hunter2");
    const snapshot = await ipc.storeLoad();
    expect(JSON.stringify(snapshot)).not.toContain("hunter2");
  });

  test("deleting a connection forgets its secrets, duplicating copies none", async () => {
    const copy = await ipc.connectionDuplicate(MOCK_IDS.ad01);
    expect(await ipc.secretHas(copy.id, "password")).toBe(false);
    await ipc.connectionDelete(MOCK_IDS.ad01);
    expect(await ipc.secretHas(MOCK_IDS.ad01, "password")).toBe(false);
  });

  test("a keyring failure can be simulated", async () => {
    failNextCall("secret_has", {
      kind: "secret",
      message: "system keyring unavailable",
      detail: null,
    });
    expect((await rejection(ipc.secretHas(MOCK_IDS.ad01, "password"))).kind).toBe("secret");
  });
});
