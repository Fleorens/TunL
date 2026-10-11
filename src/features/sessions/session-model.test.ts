import { describe, expect, test } from "vitest";
import type { SessionEvent } from "@/bindings/SessionEvent";
import {
  applySessionEvent,
  newSession,
  quickTitle,
  restartSession,
  type Session,
  tabStatus,
  uniqueTitle,
} from "./session-model";

const saved = { type: "saved", connectionId: "c-1" } as const;

function applyAll(session: Session, events: SessionEvent[]): Session {
  return events.reduce(applySessionEvent, session);
}

describe("session model", () => {
  test("a new session is connecting, with nothing done yet", () => {
    expect(newSession("s-1", "web-01", saved)).toEqual({
      id: "s-1",
      runId: "s-1",
      title: "web-01",
      target: saved,
      connectionId: "c-1",
      status: "connecting",
      steps: [],
      error: null,
      exitStatus: null,
      size: null,
    });
    const quick = { type: "quick", host: "10.5.5.5", port: 22, username: null } as const;
    expect(newSession("s-2", "10.5.5.5", quick).connectionId).toBeNull();
  });

  test("a step updates its line in place; a new kind of step is appended", () => {
    const session = applyAll(newSession("s-1", "web-01", saved), [
      { type: "step", step: "target", label: "10.0.0.12:22", state: "started" },
      { type: "step", step: "target", label: "10.0.0.12:22", state: "done" },
      { type: "step", step: "hostKey", label: "10.0.0.12", state: "started" },
    ]);
    expect(session.steps).toEqual([
      { step: "target", label: "10.0.0.12:22", state: "done" },
      { step: "hostKey", label: "10.0.0.12", state: "started" },
    ]);
    expect(session.status).toBe("connecting");
  });

  test("connected, closed and error set the status", () => {
    const start = newSession("s-1", "web-01", saved);
    const connected = applySessionEvent(start, { type: "connected" });
    expect(connected.status).toBe("connected");

    const closed = applySessionEvent(connected, {
      type: "closed",
      reason: "remoteClosed",
      exitStatus: 0,
    });
    expect(closed).toMatchObject({ status: "closed", exitStatus: 0 });

    const error = { kind: "network", message: "connection refused", detail: null } as const;
    const failed = applySessionEvent(start, { type: "error", error });
    expect(failed).toMatchObject({ status: "error", error });
  });

  test("events never mutate the session they are given", () => {
    const start = Object.freeze(newSession("s-1", "web-01", saved));
    const next = applySessionEvent(start, {
      type: "step",
      step: "auth",
      label: "deploy",
      state: "started",
    });
    expect(next).not.toBe(start);
    expect(start.steps).toEqual([]);
    expect(applySessionEvent(start, { type: "log", line: "ignored" })).toEqual(start);
  });

  test("restarting clears the previous attempt but keeps the tab and its size", () => {
    const failed = applyAll(newSession("s-1", "web-01", saved), [
      { type: "step", step: "target", label: "10.0.0.12:22", state: "failed" },
      { type: "error", error: { kind: "network", message: "refused", detail: null } },
    ]);
    // A new attempt is a new backend session: a late event of the old one can be told apart.
    const again = restartSession({ ...failed, size: { cols: 80, rows: 24 } }, "run-2");
    expect(again).toMatchObject({
      id: "s-1",
      runId: "run-2",
      title: "web-01",
      status: "connecting",
      steps: [],
      error: null,
      exitStatus: null,
      size: { cols: 80, rows: 24 },
    });
  });

  test("a second tab of the same connection is numbered", () => {
    expect(uniqueTitle("web-01", [])).toBe("web-01");
    expect(uniqueTitle("web-01", ["web-01"])).toBe("web-01 (2)");
    expect(uniqueTitle("web-01", ["web-01", "web-01 (2)"])).toBe("web-01 (3)");
    expect(uniqueTitle("web-01", ["web-01 (2)"])).toBe("web-01");
  });

  test("a quick target is titled like an ssh command line", () => {
    expect(quickTitle({ host: "10.5.5.5", port: 22, username: "deploy" })).toBe("deploy@10.5.5.5");
    expect(quickTitle({ host: "10.5.5.5", port: 2222, username: null })).toBe("10.5.5.5:2222");
  });

  test("the tab dot follows the status", () => {
    expect(tabStatus("connecting")).toBe("connecting");
    expect(tabStatus("connected")).toBe("online");
    expect(tabStatus("closed")).toBe("offline");
    expect(tabStatus("error")).toBe("error");
  });
});
