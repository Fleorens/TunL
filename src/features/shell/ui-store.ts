import { create } from "zustand";
import type { Protocol } from "@/bindings/Protocol";
import type { WindowChrome } from "@/bindings/WindowChrome";

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

  /** The import `~/.ssh/config` dialog. */
  importOpen: boolean;
  openImport: () => void;
  closeImport: () => void;

  /** The title bar the window really has (T35): the setting, unless the system bar is forced. */
  windowChrome: WindowChrome;
  setWindowChrome: (chrome: WindowChrome) => void;

  /** Whether the window is maximized (T35), so the maximize button can become restore. */
  maximized: boolean;
  setMaximized: (maximized: boolean) => void;
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

  importOpen: false,
  openImport: () => set({ importOpen: true }),
  closeImport: () => set({ importOpen: false }),

  windowChrome: { mode: "native", forced: false },
  setWindowChrome: (chrome) => set({ windowChrome: chrome }),

  maximized: false,
  setMaximized: (maximized) => set({ maximized }),
}));
