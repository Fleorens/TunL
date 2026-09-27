import { beforeEach, describe, expect, it } from "vitest";
import { failNextCall, resetMockBackend } from "@/lib/ipc-mock";
import { useConnections } from "./store";

function byName(name: string) {
  const found = useConnections
    .getState()
    .connections.find((connection) => connection.name === name);
  if (!found) throw new Error(`no connection named ${name}`);
  return found;
}

function groupNamed(name: string) {
  const found = useConnections.getState().groups.find((group) => group.name === name);
  if (!found) throw new Error(`no group named ${name}`);
  return found;
}

beforeEach(async () => {
  resetMockBackend();
  await useConnections.getState().load();
});

describe("useConnections", () => {
  it("loads the snapshot and the templates", () => {
    const state = useConnections.getState();
    expect(state.status).toBe("ready");
    expect(state.connections).toHaveLength(11);
    expect(state.groups).toHaveLength(3);
    expect(state.templates?.ssh.port).toBe(22);
  });

  it("replaces state after an action instead of mutating it", async () => {
    const before = useConnections.getState().connections;
    expect(await useConnections.getState().setFavorite(byName("nas").id, true)).toBe(true);
    expect(byName("nas").favorite).toBe(true);
    expect(before.find((connection) => connection.name === "nas")?.favorite).toBe(false);
  });

  it("moves a connection into a group, then out of any group", async () => {
    const homelab = groupNamed("Homelab");
    await useConnections.getState().moveToGroup(byName("router").id, homelab.id);
    expect(byName("router").groupId).toBe(homelab.id);
    await useConnections.getState().moveToGroup(byName("router").id, null);
    expect(byName("router").groupId).toBeNull();
  });

  it("adds a duplicate", async () => {
    const copy = await useConnections.getState().duplicate(byName("web-01").id);
    expect(copy?.name).toBe("web-01 (2)");
    expect(byName("web-01 (2)").id).toBe(copy?.id);
  });

  it("keeps the list when a delete is refused", async () => {
    expect(await useConnections.getState().remove(byName("bastion-01").id)).toBe(false);
    expect(useConnections.getState().connections).toHaveLength(11);
  });

  it("returns form errors to the caller", async () => {
    const templates = useConnections.getState().templates;
    if (!templates) throw new Error("templates missing");
    const created = await useConnections
      .getState()
      .create({ ...templates.ssh, name: " ", host: "h" });
    expect(created).toMatchObject({ ok: false, error: { kind: "validation" } });
    const group = await useConnections.getState().createGroup({ name: "homelab", color: null });
    expect(group).toMatchObject({ ok: false, error: { kind: "validation" } });
  });

  it("ungroups the connections of a deleted group", async () => {
    expect(await useConnections.getState().removeGroup(groupNamed("Homelab").id)).toBe(true);
    expect(useConnections.getState().groups).toHaveLength(2);
    expect(byName("nas").groupId).toBeNull();
  });

  it("reorders groups", async () => {
    expect(await useConnections.getState().moveGroup(groupNamed("Homelab").id, -1)).toBe(true);
    const names = useConnections.getState().groups.map((group) => group.name);
    expect(names).toEqual(["Production", "Homelab", "Clients"]);
  });

  it("switches to the error state when loading fails", async () => {
    failNextCall("store_load", { kind: "store", message: "created by a newer TunL", detail: null });
    await useConnections.getState().load();
    expect(useConnections.getState().status).toBe("error");
    expect(useConnections.getState().loadError?.message).toBe("created by a newer TunL");
  });
});
