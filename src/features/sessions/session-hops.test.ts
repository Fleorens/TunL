// T22: a session through several bastions keeps one step line per bastion.
import { describe, expect, test } from "vitest";
import type { SessionEvent } from "@/bindings/SessionEvent";
import { applySessionEvent, newSession, type Session } from "./session-model";

function fold(events: SessionEvent[]): Session {
  const start = newSession("tab-1", "web-01", {
    type: "saved",
    connectionId: "00000000-0000-4000-8000-000000000001",
  });
  return events.reduce(applySessionEvent, start);
}

describe("hop steps", () => {
  test("each bastion has its own line, in the order they started", () => {
    const session = fold([
      { type: "step", step: "hop", label: "outer", state: "started" },
      { type: "step", step: "hop", label: "outer", state: "done" },
      { type: "step", step: "hop", label: "inner", state: "started" },
    ]);
    expect(session.steps).toEqual([
      { step: "hop", label: "outer", state: "done" },
      { step: "hop", label: "inner", state: "started" },
    ]);
  });

  test("a failed bastion marks its own line only", () => {
    const session = fold([
      { type: "step", step: "hop", label: "outer", state: "started" },
      { type: "step", step: "hop", label: "outer", state: "done" },
      { type: "step", step: "hop", label: "inner", state: "started" },
      { type: "step", step: "hop", label: "inner", state: "failed" },
      {
        type: "error",
        error: { kind: "auth", message: "authentication failed", detail: null },
      },
    ]);
    expect(session.status).toBe("error");
    expect(session.steps).toEqual([
      { step: "hop", label: "outer", state: "done" },
      { step: "hop", label: "inner", state: "failed" },
    ]);
  });

  test("the target's steps follow the bastions", () => {
    const session = fold([
      { type: "step", step: "hop", label: "outer", state: "done" },
      { type: "step", step: "target", label: "db.internal:22", state: "started" },
      { type: "step", step: "target", label: "db.internal:22", state: "done" },
    ]);
    expect(session.steps.map((s) => `${s.step}:${s.label}:${s.state}`)).toEqual([
      "hop:outer:done",
      "target:db.internal:22:done",
    ]);
  });
});
