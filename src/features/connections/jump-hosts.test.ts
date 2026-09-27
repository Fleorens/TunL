import { describe, expect, it } from "vitest";
import type { Connection } from "@/bindings/Connection";
import { eligibleJumpHosts, jumpChainNames } from "./jump-hosts";

function ssh(name: string, jumpHostId: string | null = null): Connection {
  return {
    id: name,
    name,
    host: `${name}.example`,
    port: 22,
    username: null,
    groupId: null,
    tags: [],
    favorite: false,
    color: null,
    notes: null,
    jumpHostId,
    wol: null,
    settings: {
      protocol: "ssh",
      auth: { method: "agent" },
      keepaliveSecs: null,
      connectTimeoutSecs: null,
    },
    createdAt: 0,
    updatedAt: 0,
    lastConnectedAt: null,
  };
}

function rdp(name: string): Connection {
  return {
    ...ssh(name),
    port: 3389,
    settings: {
      protocol: "rdp",
      domain: null,
      display: { mode: "fit" },
      multimon: false,
      dynamicResolution: true,
      clipboard: true,
      audio: "local",
      shareHome: false,
      certPolicy: "prompt",
      extraArgs: [],
    },
  };
}

// web → inner → bastion (web jumps through inner, which jumps through bastion).
const all = [ssh("web", "inner"), rdp("win"), ssh("inner", "bastion"), ssh("bastion")];

describe("jump hosts", () => {
  it("offers the SSH connections, sorted by name", () => {
    expect(eligibleJumpHosts(all, null).map((c) => c.name)).toEqual(["bastion", "inner", "web"]);
  });

  it("never offers the connection itself, nor one that goes through it", () => {
    expect(eligibleJumpHosts(all, "inner").map((c) => c.name)).toEqual(["bastion"]);
    expect(eligibleJumpHosts(all, "bastion").map((c) => c.name)).toEqual([]);
  });

  it("never offers a host whose chain is already four bastions long", () => {
    const names = ["h1", "h2", "h3", "h4", "h5"];
    const chain = names.map((name, index) => ssh(name, index === 0 ? null : names[index - 1]));
    expect(eligibleJumpHosts(chain, null).map((c) => c.name)).toEqual(["h1", "h2", "h3", "h4"]);
  });

  it("describes the chain from the user's side", () => {
    expect(jumpChainNames(all, "web")).toEqual(["bastion", "inner", "web"]);
    expect(jumpChainNames(all, "bastion")).toEqual(["bastion"]);
    expect(jumpChainNames(all, "")).toEqual([]);
  });

  it("stops on a loop or a missing link", () => {
    expect(jumpChainNames([ssh("a", "b"), ssh("b", "a")], "a")).toEqual(["b", "a"]);
    expect(jumpChainNames([ssh("x", "gone")], "x")).toEqual(["x"]);
  });
});
