import { beforeEach, describe, expect, test } from "vitest";
import type { PromptKind } from "@/bindings/PromptKind";
import type { PromptRequest } from "@/bindings/PromptRequest";
import { toAppError } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import { resetMockBackend } from "@/lib/ipc-mock";
import { askMockPrompt, cancelMockPrompts, subscribeMockPrompts } from "@/lib/mock/prompts";

const hostKey: PromptKind = {
  kind: "hostKeyUnknown",
  host: "db.internal",
  port: 22,
  keyType: "ssh-ed25519",
  fingerprint: "SHA256:x",
};

function listen() {
  const seen: PromptRequest[] = [];
  const unsubscribe = subscribeMockPrompts((request) => seen.push(request));
  return { seen, unsubscribe };
}

beforeEach(() => {
  resetMockBackend();
});

describe("mock prompts", () => {
  test("a prompt reaches the subscribers and waits for prompt_answer", async () => {
    const { seen } = listen();
    const answer = askMockPrompt("s-1", hostKey);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ sessionId: "s-1", prompt: hostKey });
    await ipc.promptAnswer(seen[0].id, { kind: "accept" });
    await expect(answer).resolves.toEqual({ kind: "accept" });
  });

  test("answering twice, or an unknown id, is not found", async () => {
    const { seen } = listen();
    void askMockPrompt("s-1", hostKey);
    await ipc.promptAnswer(seen[0].id, { kind: "reject" });
    try {
      await ipc.promptAnswer(seen[0].id, { kind: "reject" });
      throw new Error("expected a rejection");
    } catch (error) {
      expect(toAppError(error).kind).toBe("notFound");
    }
  });

  test("closing a session cancels its prompts only", async () => {
    listen();
    const closed = askMockPrompt("s-1", hostKey);
    const other = askMockPrompt("s-2", hostKey);
    cancelMockPrompts("s-1");
    await expect(closed).resolves.toEqual({ kind: "cancel" });
    let settled = false;
    void other.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
  });

  test("an unsubscribed listener hears nothing more", () => {
    const { seen, unsubscribe } = listen();
    unsubscribe();
    void askMockPrompt("s-1", hostKey);
    expect(seen).toHaveLength(0);
  });
});
