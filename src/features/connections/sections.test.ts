import { describe, expect, it } from "vitest";
import type { Connection } from "@/bindings/Connection";
import type { Group } from "@/bindings/Group";
import { buildSidebarSections } from "./sections";

function connection(name: string, patch: Partial<Connection> = {}): Connection {
  return {
    id: `id-${name}`,
    name,
    host: "10.0.0.1",
    port: 22,
    username: null,
    groupId: null,
    tags: [],
    favorite: false,
    color: null,
    notes: null,
    jumpHostId: null,
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
    ...patch,
  };
}

const groups: Group[] = [
  { id: "g-b", name: "Beta", color: null },
  { id: "g-a", name: "Alpha", color: "green" },
];

describe("buildSidebarSections", () => {
  it("sorts favorites by name and keeps the five most recent", () => {
    const items = [
      connection("zeta", { favorite: true }),
      connection("alpha", { favorite: true }),
      ...[1, 2, 3, 4, 5, 6].map((n) => connection(`r${n}`, { lastConnectedAt: n * 1000 })),
    ];
    const sections = buildSidebarSections(items, groups);
    expect(sections.favorites.map((c) => c.name)).toEqual(["alpha", "zeta"]);
    expect(sections.recents.map((c) => c.name)).toEqual(["r6", "r5", "r4", "r3", "r2"]);
  });

  it("keeps the store order of the groups, empty groups included", () => {
    const items = [connection("web", { groupId: "g-a" }), connection("db", { groupId: "g-a" })];
    const sections = buildSidebarSections(items, groups);
    expect(sections.groups.map(({ group }) => group.name)).toEqual(["Beta", "Alpha"]);
    expect(sections.groups[0].connections).toEqual([]);
    expect(sections.groups[1].connections.map((c) => c.name)).toEqual(["db", "web"]);
    expect(sections.ungrouped).toEqual([]);
  });

  it("sorts names naturally and without regard to case", () => {
    const items = [connection("web-10"), connection("web-2"), connection("Web-1")];
    const names = buildSidebarSections(items, []).ungrouped.map((c) => c.name);
    expect(names).toEqual(["Web-1", "web-2", "web-10"]);
  });

  it("treats an unknown group as no group", () => {
    const sections = buildSidebarSections([connection("orphan", { groupId: "g-gone" })], groups);
    expect(sections.ungrouped.map((c) => c.name)).toEqual(["orphan"]);
  });

  it("never mutates its inputs", () => {
    const items = Object.freeze([
      connection("b", { favorite: true }),
      connection("a", { favorite: true }),
    ]);
    expect(() => buildSidebarSections(items, Object.freeze([...groups]))).not.toThrow();
    expect(items.map((c) => c.name)).toEqual(["b", "a"]);
  });
});
