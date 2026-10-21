// Listen for the prompts the backend poses (T21b), the files dropped on the window (T26b), and the window
// resize that toggles maximize (T35). This is the ONLY file that calls `listen()`, `onDragDropEvent`, and
// `onResized`.
//
// In Tauri, `listen()` resolves to the unsubscribe function asynchronously: keep it, and unsubscribe even if the
// caller goes away before it resolves (docs/01 §7). In the mock and tests, the prompt bus is the synchronous
// subscriber registry in `lib/mock/prompts.ts`, the resize bus in `lib/mock/window.ts`, and dropping does nothing.
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { type DragDropEvent, getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { PromptRequest } from "@/bindings/PromptRequest";
import { subscribeMockPrompts } from "./mock/prompts";
import { subscribeMockWindowMaximized } from "./mock/window";

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

/**
 * Calls `handler` when the window is maximized or restored (T35): once now with the current state, then on every
 * resize. Returns the unsubscribe function.
 */
export function onWindowMaximized(handler: (maximized: boolean) => void): () => void {
  if (isTauri()) {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    const appWindow = getCurrentWindow();

    // `isMaximized()` is async, so report the state once now and on every resize through it.
    const report = (): void => {
      appWindow.isMaximized().then(
        (maximized) => {
          if (!cancelled) handler(maximized);
        },
        // State unreadable: the maximize button keeps its last label until the next resize.
        () => undefined,
      );
    };

    report();
    void appWindow.onResized(report).then((fn) => {
      unlisten = fn;
      if (cancelled) fn();
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }
  return subscribeMockWindowMaximized(handler);
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
