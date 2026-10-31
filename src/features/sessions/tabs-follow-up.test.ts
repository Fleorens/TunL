// T59 follow-up: a duplicate takes the base title, not the numbered one of the tab it copies.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ipc } from "@/lib/ipc";
import { useSessions } from "./store";

beforeEach(() => {
  vi.spyOn(ipc, "sshOpen").mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  useSessions.setState({ sessions: [], activeId: null, closing: null });
});

describe("duplicate title", () => {
  test("duplicating a numbered tab does not stack numbers", () => {
    const target = { type: "quick", host: "nas", port: 22, username: null } as const;
    const { open, duplicate } = useSessions.getState();
    const first = open(target, "nas");
    duplicate(first);
    const second = useSessions.getState().sessions[1];
    expect(second.title).toBe("nas (2)");
    duplicate(second.id);
    const titles = useSessions.getState().sessions.map((s) => s.title);
    expect(titles.some((title) => title.includes("(2) (2)"))).toBe(false);
    expect(titles).toHaveLength(3);
    expect(new Set(titles).size).toBe(3);
  });
});
