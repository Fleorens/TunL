// Mock of the prompt broker (T21b): the backend poses a question, the UI answers it.
//
// A prompt reaches every subscriber at once (synchronously, like the real event bus), and the returned
// promise settles when `prompt_answer` answers it, when the session is cancelled, or never until reset.
// The retained scenario state (learned host keys, remembered passwords, removed keys) lives here too,
// so `known_host_remove` and the scenarios share it; `resetMockPrompts()` clears it (docs/06 §S1, S6).
import type { AppError } from "@/bindings/AppError";
import type { PromptAnswer } from "@/bindings/PromptAnswer";
import type { PromptKind } from "@/bindings/PromptKind";
import type { PromptRequest } from "@/bindings/PromptRequest";
import type { Handler } from "./data";
import { arg } from "./data";

type PromptSubscriber = (request: PromptRequest) => void;

interface Pending {
  sessionId: string;
  resolve: (answer: PromptAnswer) => void;
  reject: (error: unknown) => void;
}

const subscribers = new Set<PromptSubscriber>();
const pending = new Map<string, Pending>();

// Retained scenario state, reset by `resetMockPrompts()`.
const learnedHostKeys = new Set<string>();
const storedPasswords = new Set<string>();
const removedHostKeys = new Set<string>();

function notFound(what: string): AppError {
  return { kind: "notFound", message: what, detail: null };
}

/** Emit one prompt to every subscriber, then wait for its answer. */
function emit(sessionId: string, prompt: PromptKind): Promise<PromptAnswer> {
  const id = crypto.randomUUID();
  const request: PromptRequest = { id, sessionId, prompt };
  return new Promise<PromptAnswer>((resolve, reject) => {
    pending.set(id, { sessionId, resolve, reject });
    for (const handler of subscribers) handler(request);
  });
}

/** Answer a pending prompt, or reject with `notFound` if the id is unknown or already answered. */
function answer(id: string, value: PromptAnswer): void {
  const entry = pending.get(id);
  if (!entry) throw notFound(`prompt ${id}`);
  pending.delete(id);
  entry.resolve(value);
}

export function subscribeMockPrompts(handler: PromptSubscriber): () => void {
  subscribers.add(handler);
  return () => {
    subscribers.delete(handler);
  };
}

/** Emits at once (synchronously) to every subscriber, then waits for prompt_answer. */
export function askMockPrompt(sessionId: string, prompt: PromptKind): Promise<PromptAnswer> {
  return emit(sessionId, prompt);
}

/** Resolves every pending prompt of this session with `{ kind: "cancel" }`. */
export function cancelMockPrompts(sessionId: string): void {
  for (const [id, entry] of pending) {
    if (entry.sessionId === sessionId) {
      pending.delete(id);
      entry.resolve({ kind: "cancel" });
    }
  }
}

export const promptHandlers: Record<string, Handler<Record<string, unknown>>> = {
  prompt_answer(state, args) {
    const { id, answer: value } = arg<{ id: string; answer: PromptAnswer }>(args);
    answer(id, value);
    return { state, result: null };
  },

  known_host_remove(state, args) {
    const { host, port } = arg<{ host: string; port: number }>(args);
    // The first removal of a given host drops one line (1); a later one removes nothing (0).
    if (removedHostKeys.has(`${host}:${port}`)) return { state, result: 0 };
    removedHostKeys.add(`${host}:${port}`);
    return { state, result: 1 };
  },
};

// Retained scenario state, read and written by the scenarios in `lib/mock/scenarios.ts`.
export function isHostKeyLearned(host: string, port: number): boolean {
  return learnedHostKeys.has(`${host}:${port}`);
}
export function markHostKeyLearned(host: string, port: number): void {
  learnedHostKeys.add(`${host}:${port}`);
}
export function hasStoredPassword(name: string): boolean {
  return storedPasswords.has(name);
}
export function rememberPassword(name: string): void {
  storedPasswords.add(name);
}
export function isHostKeyRemoved(host: string, port: number): boolean {
  return removedHostKeys.has(`${host}:${port}`);
}

/** Clear subscribers, pending prompts, and the retained scenario state, for `resetMockBackend()`. */
export function resetMockPrompts(): void {
  subscribers.clear();
  pending.clear();
  learnedHostKeys.clear();
  storedPasswords.clear();
  removedHostKeys.clear();
}
