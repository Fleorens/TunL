// Mock of the window the TunL title bar controls (T35): the maximize state it follows and the command that
// drops (or keeps) the decorations.
//
// The window is never maximized by default; `window_toggle_maximize` inverts the state and tells every
// subscriber of `onWindowMaximized` (events.ts), like the real resize event. `window_apply_title_bar` just
// reports the chosen mode; `window_minimize` and `window_close` do nothing. Reset by `resetMockWindow()`.
import type { TitleBarMode } from "@/bindings/TitleBarMode";
import type { WindowChrome } from "@/bindings/WindowChrome";
import type { Handler } from "./data";
import { arg } from "./data";

type MaximizedSubscriber = (maximized: boolean) => void;

const subscribers = new Set<MaximizedSubscriber>();
let maximized = false;

/** Register `handler` for every maximize/restore, and return its unsubscribe. */
export function subscribeMockWindowMaximized(handler: MaximizedSubscriber): () => void {
  subscribers.add(handler);
  return () => {
    subscribers.delete(handler);
  };
}

function notifyMaximized(): void {
  for (const handler of subscribers) handler(maximized);
}

/** The window chrome the top bar reads: the chosen mode, never forced (the mock keeps its decorations). */
function chrome(mode: TitleBarMode): WindowChrome {
  return { mode, forced: false };
}

export const windowHandlers: Record<string, Handler<Record<string, unknown>>> = {
  window_apply_title_bar(_state, args) {
    const { mode } = arg<{ mode: TitleBarMode }>(args);
    return { state: _state, result: chrome(mode) };
  },

  window_toggle_maximize(state) {
    maximized = !maximized;
    notifyMaximized();
    return { state, result: null };
  },

  window_minimize(state) {
    return { state, result: null };
  },

  window_close(state) {
    return { state, result: null };
  },
};

/** Clear subscribers and the maximize state, for `resetMockBackend()`. */
export function resetMockWindow(): void {
  maximized = false;
  subscribers.clear();
}
