import { describe, expect, test } from "vitest";
import type { SessionEvent } from "@/bindings/SessionEvent";
import {
  applySessionEvent,
  LOG_LIMIT,
  newSession,
  quickTitle,
  restartSession,
  type Session,
  stepKey,
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
      kind: "ssh",
      runId: "s-1",
      title: "web-01",
      target: saved,
      connectionId: "c-1",
      status: "connecting",
      steps: [],
      error: null,
      exitStatus: null,
      size: null,
      log: [],
    });
    const quick = { type: "quick", host: "10.5.5.5", port: 22, username: null } as const;
    expect(newSession("s-2", "10.5.5.5", quick).connectionId).toBeNull();
    // T25: an SFTP tab is the same session, of another kind.
    expect(newSession("s-3", "web-01", saved, "sftp").kind).toBe("sftp");
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
    // T28b: a log line is kept, on a new object.
    const logged = applySessionEvent(start, { type: "log", line: "[INFO] connected" });
    expect(logged.log).toEqual(["[INFO] connected"]);
    expect(start.log).toEqual([]);
  });

  test("the log keeps its last LOG_LIMIT lines, and a new attempt starts it again", () => {
    const lines = Array.from({ length: LOG_LIMIT + 5 }, (_, i) => `line ${i}`);
    const full = applyAll(
      newSession("s-1", "ad-01", saved, "rdp"),
      lines.map((line) => ({ type: "log", line })),
    );
    expect(full.log).toHaveLength(LOG_LIMIT);
    expect(full.log[0]).toBe("line 5");
    expect(full.log.at(-1)).toBe(`line ${LOG_LIMIT + 4}`);
    expect(restartSession(full, "run-2").log).toEqual([]);
  });

  test("an Open step reads as what it opens", () => {
    expect(stepKey({ step: "open", label: "shell" })).toBe("sessions.steps.open");
    expect(stepKey({ step: "open", label: "sftp" })).toBe("sessions.steps.openSftp");
    expect(stepKey({ step: "open", label: "tunnel" })).toBe("sessions.steps.openTunnel");
    expect(stepKey({ step: "launch", label: "sdl-freerdp3" })).toBe("sessions.steps.launch");
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
