import { create } from "zustand";
import type { Protocol } from "@/bindings/Protocol";

/** Where the editor comes from: create (optionally prefilled with a protocol) or edit an existing connection. */
export type EditorTarget = { mode: "create"; protocol?: Protocol } | { mode: "edit"; id: string };

interface UiState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  /** The open editor, or `null` when it is closed. */
  editor: EditorTarget | null;
  openEditor: (target: EditorTarget) => void;
  closeEditor: () => void;
}

export const useUi = create<UiState>()((set) => ({
  sidebarCollapsed: false,
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  editor: null,
  openEditor: (target) => set({ editor: target }),
  closeEditor: () => set({ editor: null }),
}));
