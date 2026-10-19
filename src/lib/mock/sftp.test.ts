// T24: the mock's SFTP tabs and file system, which the explorer of T25 is built against.
import { beforeEach, describe, expect, test } from "vitest";
import type { SessionEvent } from "@/bindings/SessionEvent";
import { toAppError } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import { resetMockBackend } from "@/lib/ipc-mock";
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

/** Open an SFTP tab on `connectionId` and wait until it is connected; returns its id and its events. */
async function openTab(connectionId: string) {
  const id = crypto.randomUUID();
  const events: SessionEvent[] = [];
  await new Promise<void>((resolve) => {
    void ipc.sftpOpen(id, { type: "saved", connectionId }, (event) => {
      events.push(event);
      if (event.type === "connected") resolve();
    });
  });
  return { id, events };
}

describe("mock sftp_open", () => {
  test("goes through the connecting steps, then opens the sftp subsystem", async () => {
    const { events } = await openTab(MOCK_IDS.nas);
    const steps = events.filter((e) => e.type === "step").map((e) => `${e.step}:${e.state}`);
    expect(steps.slice(0, 2)).toEqual(["target:started", "target:done"]);
    expect(steps.slice(-2)).toEqual(["open:started", "open:done"]);
    expect(events.at(-1)).toEqual({ type: "connected" });
  });

  test("goes through the bastion first", async () => {
    const { events } = await openTab(MOCK_IDS.web01);
    expect(events[0]).toEqual({ type: "step", step: "hop", label: "bastion-01", state: "started" });
  });
});

describe("mock sftp operations", () => {
  test("the home directory and its listing", async () => {
    const { id } = await openTab(MOCK_IDS.nas);
    const home = await ipc.sftpRealpath(id, ".");
    expect(home).toBe("/home/admin");
    const entries = await ipc.sftpList(id, home);
    expect(entries.map((e) => [e.name, e.kind, e.hidden])).toEqual([
      [".bashrc", "file", true],
      ["backup.tar.gz", "file", false],
      ["current", "symlink", false],
      ["notes.txt", "file", false],
      ["projects", "dir", false],
    ]);
    expect(entries[4].path).toBe("/home/admin/projects");
    expect(await ipc.sftpRealpath(id, "/home/admin/projects/../projects/")).toBe(
      "/home/admin/projects",
    );
  });

  test("mkdir, rename, chmod, count and remove", async () => {
    const { id } = await openTab(MOCK_IDS.nas);
    await ipc.sftpMkdir(id, "/home/admin/new");
    await ipc.sftpRename(id, "/home/admin/projects", "/home/admin/code");
    expect(await ipc.sftpCount(id, "/home/admin/code")).toBe(4);
    await ipc.sftpChmod(id, "/home/admin/new", 0o700);
    const names = (await ipc.sftpList(id, "/home/admin")).map((e) => e.name);
    expect(names).toContain("new");
    expect(names).toContain("code");
    expect(names).not.toContain("projects");
    const created = (await ipc.sftpList(id, "/home/admin")).find((e) => e.name === "new");
    expect(created?.permissions).toBe(0o700);

    await ipc.sftpRemove(id, "/home/admin/code");
    expect((await ipc.sftpList(id, "/home/admin")).map((e) => e.name)).not.toContain("code");
    expect((await rejection(ipc.sftpList(id, "/home/admin/code/app"))).kind).toBe("notFound");
  });

  test("the backend's refusals", async () => {
    const { id } = await openTab(MOCK_IDS.nas);
    expect((await rejection(ipc.sftpMkdir(id, "/home/admin/projects"))).kind).toBe("sftp");
    expect((await rejection(ipc.sftpList(id, "relative"))).kind).toBe("validation");
    expect((await rejection(ipc.sftpRemove(id, "/"))).kind).toBe("validation");
    expect((await rejection(ipc.sftpChmod(id, "/home/admin/notes.txt", 0o17777))).kind).toBe(
      "validation",
    );
  });

  test("a closed tab, or one never opened, has no session", async () => {
    const { id } = await openTab(MOCK_IDS.nas);
    await ipc.sessionClose(id);
    expect((await rejection(ipc.sftpList(id, "/"))).kind).toBe("notFound");
    expect((await rejection(ipc.sftpList(crypto.randomUUID(), "/"))).kind).toBe("notFound");
  });
});
