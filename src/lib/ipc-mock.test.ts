import { beforeEach, describe, expect, it } from "vitest";
import type { ConnectionInput } from "@/bindings/ConnectionInput";
import { toInput } from "@/features/connections/to-input";
import { ipc } from "./ipc";
import { failNextCall, resetMockBackend } from "./ipc-mock";

async function sshInput(name: string): Promise<ConnectionInput> {
  const templates = await ipc.connectionTemplates();
  return { ...templates.ssh, name, host: "10.9.9.9" };
}

async function connectionNamed(name: string) {
  const { connections } = await ipc.storeLoad();
  const found = connections.find((connection) => connection.name === name);
  if (!found) throw new Error(`no connection named ${name}`);
  return found;
}

beforeEach(() => {
  resetMockBackend();
});

describe("mock backend: store", () => {
  it("serves the demo data", async () => {
    const snapshot = await ipc.storeLoad();
    expect(snapshot.groups.map((group) => group.name)).toEqual([
      "Production",
      "Clients",
      "Homelab",
    ]);
    expect(snapshot.connections).toHaveLength(11);
    expect(snapshot.quarantined).toEqual([]);
  });

  it("starts over after a reset", async () => {
    await ipc.connectionCreate(await sshInput("temp"));
    resetMockBackend();
    expect((await ipc.storeLoad()).connections).toHaveLength(11);
  });

  it("offers templates with the protocol default ports", async () => {
    const templates = await ipc.connectionTemplates();
    expect(templates.ssh.port).toBe(22);
    expect(templates.rdp.port).toBe(3389);
    expect(templates.rdp.settings.protocol).toBe("rdp");
    expect(templates.wol.broadcast).toBe("255.255.255.255");
  });
});

describe("mock backend: connections", () => {
  it("creates a connection with an id and timestamps", async () => {
    const created = await ipc.connectionCreate(await sshInput("  staging "));
    expect(created.name).toBe("staging");
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.createdAt).toBe(created.updatedAt);
    const names = (await ipc.storeLoad()).connections.map((connection) => connection.name);
    expect(names).toContain("staging");
  });

  it("rejects an empty name with a field-tagged validation error", async () => {
    await expect(ipc.connectionCreate(await sshInput("  "))).rejects.toMatchObject({
      kind: "validation",
      message: expect.stringMatching(/^name:/),
    });
  });

  it("updates a connection and keeps its creation date", async () => {
    const router = await connectionNamed("router");
    const updated = await ipc.connectionUpdate(router.id, { ...toInput(router), name: "gateway" });
    expect(updated.name).toBe("gateway");
    expect(updated.id).toBe(router.id);
    expect(updated.createdAt).toBe(router.createdAt);
  });

  it("duplicates with the next free suffix", async () => {
    const web = await connectionNamed("web-01");
    expect((await ipc.connectionDuplicate(web.id)).name).toBe("web-01 (2)");
    expect((await ipc.connectionDuplicate(web.id)).name).toBe("web-01 (3)");
  });

  it("refuses to delete a bastion that is still in use", async () => {
    const bastion = await connectionNamed("bastion-01");
    await expect(ipc.connectionDelete(bastion.id)).rejects.toMatchObject({
      kind: "inUse",
      detail: { type: "inUse", names: ["db-prod", "web-01", "web-02"] },
    });
  });

  it("favorites, touches and deletes", async () => {
    const nas = await connectionNamed("nas");
    expect((await ipc.connectionSetFavorite(nas.id, true)).favorite).toBe(true);
    expect((await ipc.connectionTouch(nas.id)).lastConnectedAt).toBeGreaterThan(0);
    await ipc.connectionDelete(nas.id);
    const names = (await ipc.storeLoad()).connections.map((connection) => connection.name);
    expect(names).not.toContain("nas");
  });

  it("keeps the demo bastion links and the Wake-on-LAN example", async () => {
    const bastion = await connectionNamed("bastion-01");
    expect((await connectionNamed("db-prod")).jumpHostId).toBe(bastion.id);
    expect((await connectionNamed("win-desktop")).wol?.mac).toBe("52:54:00:12:34:56");
    expect((await connectionNamed("nas")).wol).toBeNull();
  });
});

describe("mock backend: groups and settings", () => {
  it("deleting a group ungroups its connections", async () => {
    const { groups } = await ipc.storeLoad();
    const homelab = groups.find((group) => group.name === "Homelab");
    if (!homelab) throw new Error("Homelab missing");
    const snapshot = await ipc.groupDelete(homelab.id);
    expect(snapshot.groups.map((group) => group.name)).toEqual(["Production", "Clients"]);
    expect(
      snapshot.connections.find((connection) => connection.name === "nas")?.groupId,
    ).toBeNull();
  });

  it("creates, renames and reorders groups", async () => {
    const lab = await ipc.groupCreate({ name: "Lab", color: "teal" });
    await expect(ipc.groupCreate({ name: "lab", color: null })).rejects.toMatchObject({
      kind: "validation",
    });
    expect((await ipc.groupUpdate(lab.id, { name: "Lab 2", color: null })).name).toBe("Lab 2");
    const ids = (await ipc.storeLoad()).groups.map((group) => group.id).reverse();
    expect((await ipc.groupReorder(ids)).map((group) => group.id)).toEqual(ids);
  });

  it("round-trips settings", async () => {
    const settings = await ipc.settingsGet();
    expect(settings.theme).toBe("system");
    expect((await ipc.settingsUpdate({ ...settings, theme: "light" })).theme).toBe("light");
    expect((await ipc.settingsGet()).theme).toBe("light");
  });

  it("can simulate a failure on the next call only", async () => {
    failNextCall("store_load", { kind: "store", message: "boom", detail: null });
    await expect(ipc.storeLoad()).rejects.toMatchObject({ kind: "store" });
    await expect(ipc.storeLoad()).resolves.toMatchObject({ quarantined: [] });
  });
});
