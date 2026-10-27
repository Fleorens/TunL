// T45: a tab's pending questions go away when its attempt fails or ends, not only when the tab closes.
import { afterEach, describe, expect, test, vi } from "vitest";
import type { SessionEvent } from "@/bindings/SessionEvent";
import { usePrompts } from "@/features/prompts/store";
import { ipc } from "@/lib/ipc";
import { useSessions } from "./store";

afterEach(() => {
  vi.restoreAllMocks();
  useSessions.setState({ sessions: [], activeId: null, closing: null });
  usePrompts.setState({ queue: [] });
});

/** Open a quick tab whose backend never answers, and return the way to send it events. */
function openTab(): { id: string; emit: (event: SessionEvent) => void } {
  const handlers: Array<(event: SessionEvent) => void> = [];
  vi.spyOn(ipc, "sshOpen").mockImplementation((_id, _target, _size, callbacks) => {
    handlers.push(callbacks.onEvent);
    return Promise.resolve();
  });
  const id = useSessions
    .getState()
    .open({ type: "quick", host: "10.0.0.1", port: 22, username: null }, "quick");
  const emit = (event: SessionEvent): void => {
    for (const handler of handlers) handler(event);
  };
  return { id, emit };
}

function ask(sessionId: string): void {
  usePrompts.getState().push({
    id: crypto.randomUUID(),
    sessionId,
    prompt: {
      kind: "password",
      connectionName: "quick",
      username: "root",
      host: "10.0.0.1",
      canSave: false,
      retry: false,
    },
  });
}

describe("the pending questions of a tab", () => {
  test.each<SessionEvent>([
    { type: "error", error: { kind: "cancelled", message: "prompt timed out", detail: null } },
    { type: "closed", reason: "remoteClosed", exitStatus: null },
  ])("go away when its attempt ends ($type)", (event) => {
    const tab = openTab();
    ask(tab.id);
    ask("another-session");
    tab.emit(event);
    expect(usePrompts.getState().queue.map((request) => request.sessionId)).toEqual([
      "another-session",
    ]);
  });

  test("stay while the attempt goes on", () => {
    const tab = openTab();
    ask(tab.id);
    tab.emit({ type: "step", step: "auth", label: "root", state: "started" });
    expect(usePrompts.getState().queue).toHaveLength(1);
  });
});
