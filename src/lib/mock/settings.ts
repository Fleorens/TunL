// Mock handlers for the settings commands.
import type { Settings } from "@/bindings/Settings";
import type { Handler, MockState } from "./data";
import { arg, DEMO_SETTINGS } from "./data";

/** The current settings. */
export const settingsHandlers: Record<string, Handler<Record<string, unknown>>> = {
  settings_get(state: MockState) {
    return { state, result: state.settings };
  },

  /** Replace the settings with a normalized copy (missing fields fall back to the defaults). */
  settings_update(state: MockState, args) {
    const { settings } = arg<{ settings: Settings }>(args);
    const next: Settings = { ...DEMO_SETTINGS, ...settings };
    return { state: { ...state, settings: next }, result: next };
  },
};
