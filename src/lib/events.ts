// Listen for the prompts the backend poses (T21b) and the files dropped on the window (T26b). This is the ONLY file
// that calls `listen()` and `onDragDropEvent`.
//
// In Tauri, `listen()` resolves to the unsubscribe function asynchronously: keep it, and unsubscribe even if the
// caller goes away before it resolves (docs/01 §7). In the mock and tests, the prompt bus is the synchronous
// subscriber registry in `lib/mock/prompts.ts`, and dropping does nothing.
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { type DragDropEvent, getCurrentWebview } from "@tauri-apps/api/webview";
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

/** The drag-and-drop phases the window reports back (T26b). */
export interface FileDropHandlers {
  /** The files are over the window. */
  onOver: () => void;
  /** The drag left the window. */
  onLeave: () => void;
  /** The files were dropped on the window, by absolute path. */
  onDrop: (paths: string[]) => void;
}

/** A drag-and-drop event, dispatched to the phase it carries. */
function dispatchDrop(handlers: FileDropHandlers, event: DragDropEvent): void {
  if (event.type === "drop") handlers.onDrop(event.paths);
  else if (event.type === "leave") handlers.onLeave();
  else handlers.onOver();
}

/** Calls `handlers` for every file dropped on the window. Returns the unsubscribe function. */
export function onFileDrop(handlers: FileDropHandlers): () => void {
  if (isTauri()) {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void getCurrentWebview()
      .onDragDropEvent((event) => dispatchDrop(handlers, event.payload))
      .then((fn) => {
        unlisten = fn;
        if (cancelled) fn();
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }
  return () => {};
}
