// Mock handler for the tabs of last time (T60): keep them in `sessionStorage`, so a reload of the page plays
// the role of a restart (the in-memory mock state resets, the saved tabs do not). A `sessionStorage` the browser
// rejects is ignored, never an error (S1: the ids are not a secret, but the file stays private).
import type { SavedTab } from "@/bindings/SavedTab";
import type { Handler, MockState } from "./data";
import { arg } from "./data";

/** The `sessionStorage` key holding the saved tabs as the JSON of `tabs.json`. */
const TABS_KEY = "tunl.mock.tabs";

/** Read the saved tabs the page stored, for `tabs_load`. A missing or unreadable one: none. */
export function loadMockTabs(): SavedTab[] {
  try {
    const raw = sessionStorage.getItem(TABS_KEY);
    if (!raw) return [];
    const tabs: unknown = JSON.parse(raw);
    return Array.isArray(tabs) ? (tabs as SavedTab[]) : [];
  } catch {
    return [];
  }
}

/** Write the saved tabs the page stored, for `tabs_save`. An unavailable store is ignored. */
export function saveMockTabs(tabs: SavedTab[]): void {
  try {
    sessionStorage.setItem(TABS_KEY, JSON.stringify(tabs));
  } catch {
    // sessionStorage full or unavailable: the next save is harmless to ignore.
  }
}

/** Forget the saved tabs, for `resetMockBackend()`. */
export function resetMockTabs(): void {
  try {
    sessionStorage.removeItem(TABS_KEY);
  } catch {
    // ignore
  }
}

export const tabsHandlers: Record<string, Handler<Record<string, unknown>>> = {
  tabs_load(state: MockState) {
    return { state, result: loadMockTabs() };
  },

  tabs_save(state: MockState, args) {
    const { tabs } = arg<{ tabs: SavedTab[] }>(args);
    saveMockTabs(tabs);
    return { state, result: null };
  },
};
