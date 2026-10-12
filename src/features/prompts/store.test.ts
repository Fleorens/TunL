import { beforeEach, describe, expect, test } from "vitest";
import type { PromptRequest } from "@/bindings/PromptRequest";
import { usePrompts } from "./store";

function request(id: string, sessionId: string | null): PromptRequest {
  return {
    id,
    sessionId,
    prompt: {
      kind: "password",
      connectionName: "router",
      username: "root",
      host: "192.168.1.1",
      canSave: true,
      retry: false,
    },
  };
}

beforeEach(() => {
  usePrompts.setState({ queue: [] });
});

describe("prompt queue", () => {
  test("prompts are shown one at a time, oldest first", () => {
    const { push } = usePrompts.getState();
    push(request("p-1", "s-1"));
    push(request("p-2", "s-2"));
    expect(usePrompts.getState().queue.map((r) => r.id)).toEqual(["p-1", "p-2"]);
    usePrompts.getState().resolve("p-1");
    expect(usePrompts.getState().queue.map((r) => r.id)).toEqual(["p-2"]);
  });

  test("closing a session drops its prompts", () => {
    const { push } = usePrompts.getState();
    push(request("p-1", "s-1"));
    push(request("p-2", "s-2"));
    push(request("p-3", "s-1"));
    usePrompts.getState().dropSession("s-1");
    expect(usePrompts.getState().queue.map((r) => r.id)).toEqual(["p-2"]);
  });

  test("the queue is replaced, never mutated", () => {
    const before = usePrompts.getState().queue;
    usePrompts.getState().push(request("p-1", null));
    expect(before).toEqual([]);
  });
});
