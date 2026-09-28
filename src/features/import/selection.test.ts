import { describe, expect, test } from "vitest";
import type { ImportCandidate } from "@/bindings/ImportCandidate";
import {
  candidateAddress,
  initialSelection,
  isSelectable,
  jumpLabel,
  toggleAlias,
  toggleAll,
} from "./selection";

function candidate(alias: string, patch: Partial<ImportCandidate> = {}): ImportCandidate {
  return {
    alias,
    host: `${alias}.lan`,
    port: 22,
    username: null,
    keyPath: null,
    jump: null,
    duplicateOf: null,
    warnings: [],
    error: null,
    ...patch,
  };
}

const CANDIDATES = [
  candidate("a"),
  candidate("dup", { duplicateOf: "a1000000-0000-4000-8000-000000000101" }),
  candidate("bad", { error: "host: must be a valid IPv4, IPv6 address or host name" }),
  candidate("b", { warnings: ["ProxyCommand is ignored"] }),
];

describe("import selection", () => {
  test("a candidate with an error is not selectable", () => {
    expect(isSelectable(CANDIDATES[0])).toBe(true);
    expect(isSelectable(CANDIDATES[1])).toBe(true);
    expect(isSelectable(CANDIDATES[2])).toBe(false);
  });

  test("duplicates and errors start unselected, warnings do not matter", () => {
    expect(initialSelection(CANDIDATES)).toEqual(["a", "b"]);
  });

  test("toggleAlias adds and removes without mutating", () => {
    const start = ["a"];
    const added = toggleAlias(start, "dup");
    expect(added).toEqual(["a", "dup"]);
    expect(start).toEqual(["a"]);
    expect(toggleAlias(added, "a")).toEqual(["dup"]);
  });

  test("toggleAll selects every selectable alias, then none", () => {
    const all = toggleAll(CANDIDATES, ["a"]);
    expect([...all].sort()).toEqual(["a", "b", "dup"]);
    expect(toggleAll(CANDIDATES, all)).toEqual([]);
  });

  test("toggleAll with nothing selectable gives nothing", () => {
    expect(toggleAll([CANDIDATES[2]], [])).toEqual([]);
  });

  test("jump labels", () => {
    expect(jumpLabel(null)).toBeNull();
    expect(jumpLabel({ type: "candidate", alias: "jump-box" })).toBe("jump-box");
    expect(
      jumpLabel({
        type: "existing",
        id: "a1000000-0000-4000-8000-000000000104",
        name: "bastion-01",
      }),
    ).toBe("bastion-01");
    expect(jumpLabel({ type: "unresolved", hop: "nowhere" })).toBeNull();
  });

  test("addresses leave out what is implicit", () => {
    expect(candidateAddress(candidate("a"))).toBe("a.lan");
    expect(candidateAddress(candidate("a", { username: "ops", port: 2222 }))).toBe(
      "ops@a.lan:2222",
    );
    expect(candidateAddress(candidate("a", { username: "root" }))).toBe("root@a.lan");
  });
});
