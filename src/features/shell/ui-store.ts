import { create } from "zustand";
import type { Protocol } from "@/bindings/Protocol";

/** Where the editor comes from: create (optionally prefilled with a protocol) or edit an existing connection. */
export type EditorTarget =
  | { mode: "create"; protocol?: Protocol; prefill?: PrefillTarget }
  | { mode: "edit"; id: string };

/** A host/port/username typed on the fly, used to prefill a new connection. */
export interface PrefillTarget {
  host: string;
  port: number;
  username: string | null;
}

/** What the palette opens on: everything, or the quick-connect screen only. */
export type PaletteMode = "all" | "quickConnect";

interface UiState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  /** The open editor, or `null` when it is closed. */
  editor: EditorTarget | null;
  openEditor: (target: EditorTarget) => void;
  closeEditor: () => void;

  /** The open palette, or `null` when it is closed. */
  palette: PaletteMode | null;
  openPalette: (mode: PaletteMode) => void;
  closePalette: () => void;

  /** The keyboard-shortcuts help dialog. */
  shortcutsOpen: boolean;
  openShortcuts: () => void;
  closeShortcuts: () => void;
}

export const useUi = create<UiState>()((set) => ({
  sidebarCollapsed: false,
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  editor: null,
  openEditor: (target) => set({ editor: target }),
  closeEditor: () => set({ editor: null }),

  palette: null,
  openPalette: (mode) => set({ palette: mode }),
  closePalette: () => set({ palette: null }),

  shortcutsOpen: false,
  openShortcuts: () => set({ shortcutsOpen: true }),
  closeShortcuts: () => set({ shortcutsOpen: false }),
}));
