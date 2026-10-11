// The prompts the backend posed, in order (T21b). The UI shows the first one only; resolving it or
// dropping a session's prompts removes them. The queue is replaced, never mutated (see its test).

import type { StoreApi, UseBoundStore } from "zustand";
import { create } from "zustand";
import type { PromptRequest } from "@/bindings/PromptRequest";

interface PromptsState {
  queue: readonly PromptRequest[];
  push(request: PromptRequest): void;
  /** Remove one prompt by id, once it has been answered. */
  resolve(id: string): void;
  /** Remove every prompt of a session, when its tab closes. */
  dropSession(sessionId: string): void;
}

export const usePrompts: UseBoundStore<StoreApi<PromptsState>> = create<PromptsState>((set) => ({
  queue: [],
  push(request) {
    set((state) => ({ queue: [...state.queue, request] }));
  },
  resolve(id) {
    set((state) => ({ queue: state.queue.filter((entry) => entry.id !== id) }));
  },
  dropSession(sessionId) {
    set((state) => ({ queue: state.queue.filter((entry) => entry.sessionId !== sessionId) }));
  },
}));
