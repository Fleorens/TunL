// Mock of the prompt broker (T21b): the backend poses a question, the UI answers it.
//
// A prompt reaches every subscriber at once (synchronously, like the real event bus), and the returned
// promise settles when `prompt_answer` answers it, when the session is cancelled, or never until reset.
// The retained scenario state (learned host keys, remembered passwords, removed keys) lives here too,
// so `known_host_remove` and the scenarios share it; `resetMockPrompts()` clears it (docs/06 §S1, S6).
import type { AppError } from "@/bindings/AppError";
import type { KnownHostEntry } from "@/bindings/KnownHostEntry";
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

// The three hosts the mock "knows" by default, as the Settings tab lists them (T31b). Their fingerprints
// are fixed so the list is stable; the learned keys below reuse the `ssh-ed25519` type and a fixed key.
export const MOCK_KNOWN_HOSTS: readonly KnownHostEntry[] = [
  {
    host: "192.168.1.1",
    port: 22,
    keyType: "ssh-ed25519",
    fingerprint: "SHA256:uNiVztksCsDhcc0u9e8BujQXVUpKZIDTMczCvj3tD2s",
  },
  {
    host: "192.168.1.10",
    port: 22,
    keyType: "ssh-ed25519",
    fingerprint: "SHA256:p2QAMXNIC1TJYWeIOttrVc98/R1BUFWu3/LiyKgUfQM",
  },
  {
    host: "192.168.1.2",
    port: 22,
    keyType: "ecdsa-sha2-nistp256",
    fingerprint: "SHA256:Dx9Kq3eW7xYhV2mFzJp8LcTb4NsR6uGa1oQiE5kHw0Y",
  },
];

/** A learned key, as the Settings tab would list it: `ssh-ed25519` and a fixed fingerprint. */
function learnedEntry(key: string): KnownHostEntry {
  const at = key.lastIndexOf(":");
  return {
    host: key.slice(0, at),
    port: Number(key.slice(at + 1)),
    keyType: "ssh-ed25519",
    fingerprint: "SHA256:a7Lm2TqZ9cVb4XeR1nKs8YwHd3PfJu6GoQi0BtNz5Ec",
  };
}

/**
 * The mock's own known_hosts: the preset hosts, plus the learned keys (a learned key replaces the preset of
 * the same host), minus the removed ones, sorted by host (`localeCompare`) then port. Never mutates
 * `MOCK_KNOWN_HOSTS`.
 */
function ownHosts(): KnownHostEntry[] {
  const presets = MOCK_KNOWN_HOSTS.filter(
    (entry) => !learnedHostKeys.has(`${entry.host}:${entry.port}`),
  );
  return [...presets, ...[...learnedHostKeys].map(learnedEntry)]
    .filter((entry) => !removedHostKeys.has(`${entry.host}:${entry.port}`))
    .sort((a, b) => a.host.localeCompare(b.host) || a.port - b.port);
}

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
    // Forgotten: the next connection asks for the fingerprint again, as in the real app.
    learnedHostKeys.delete(`${host}:${port}`);
    return { state, result: 1 };
  },

  known_hosts_list(state) {
    return { state, result: ownHosts() };
  },
};

// Retained scenario state, read and written by the scenarios in `lib/mock/scenarios.ts`.
export function isHostKeyLearned(host: string, port: number): boolean {
  return learnedHostKeys.has(`${host}:${port}`);
}
export function markHostKeyLearned(host: string, port: number): void {
  learnedHostKeys.add(`${host}:${port}`);
  // Approved again after « Forget »: back in the list, as the real app writes the line again.
  removedHostKeys.delete(`${host}:${port}`);
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
