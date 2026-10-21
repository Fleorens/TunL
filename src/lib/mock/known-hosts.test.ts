// T31b: the mock's own known_hosts, shared with the host-key scenarios and `known_host_remove`.
import { beforeEach, describe, expect, test } from "vitest";
import { ipc } from "@/lib/ipc";
import { resetMockBackend } from "@/lib/ipc-mock";
import { markHostKeyLearned } from "@/lib/mock/prompts";

beforeEach(() => {
  resetMockBackend();
});

describe("mock known_hosts_list", () => {
  test("three hosts at start, sorted by host", async () => {
    const hosts = await ipc.knownHostsList();
    expect(hosts.map((h) => `${h.host}:${h.port}`)).toEqual([
      "192.168.1.1:22",
      "192.168.1.10:22",
      "192.168.1.2:22",
    ]);
    expect(hosts.every((h) => h.fingerprint.startsWith("SHA256:"))).toBe(true);
  });

  test("a learned host joins the list; a removed one leaves it", async () => {
    markHostKeyLearned("db.internal", 2222);
    expect((await ipc.knownHostsList()).map((h) => h.host)).toContain("db.internal");

    expect(await ipc.knownHostRemove("192.168.1.10", 22)).toBe(1);
    const hosts = await ipc.knownHostsList();
    expect(hosts.map((h) => h.host)).not.toContain("192.168.1.10");
    expect(hosts.find((h) => h.host === "db.internal")?.port).toBe(2222);
  });
});
