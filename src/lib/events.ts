// Listen for the prompts the backend poses (T21b). This is the ONLY file that calls `listen()`.
//
// In Tauri, `listen()` resolves to the unsubscribe function asynchronously: keep it, and unsubscribe
// even if the caller goes away before it resolves (docs/01 §7). In the mock and tests, the prompt bus
// is the synchronous subscriber registry in `lib/mock/prompts.ts`.
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { PromptRequest } from "@/bindings/PromptRequest";
import { subscribeMockPrompts } from "./mock/prompts";

/** The global event the backend emits a prompt on. */
export const PROMPT_EVENT = "tunl://prompt";

/** Calls `handler` for every prompt the backend asks. Returns the unsubscribe function. */
export function onPrompt(handler: (request: PromptRequest) => void): () => void {
  if (isTauri()) {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void listen<PromptRequest>(PROMPT_EVENT, (event) => handler(event.payload)).then((fn) => {
      unlisten = fn;
      if (cancelled) fn();
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }
  return subscribeMockPrompts(handler);
}
