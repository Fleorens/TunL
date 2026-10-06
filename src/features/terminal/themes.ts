import type { ISearchDecorationOptions } from "@xterm/addon-search";
import type { ITheme } from "@xterm/xterm";
import type { TerminalTheme } from "@/bindings/TerminalTheme";

/**
 * The search decoration colors of a theme. These are theme data (not colors written in a
 * component), so they live here alongside the palettes. `matchOverviewRuler` and
 * `activeMatchColorOverviewRuler` are required by the SearchAddon.
 */
export interface SearchColors {
  matchBackground: string;
  matchOverviewRuler: string;
  activeMatchBackground: string;
  activeMatchColorOverviewRuler: string;
}

/** TunL Night — docs/03-design.md §9, column tunl-night, the sixteen ANSI colors included. */
export const TUNL_NIGHT: ITheme = {
  background: "#0a0d12",
  foreground: "#e6e8ee",
  cursor: "#17cced",
  cursorAccent: "#0a0d12",
  selectionBackground: "#17cced40",
  black: "#1c2029",
  red: "#ff6b70",
  green: "#52db9c",
  yellow: "#f3c14c",
  blue: "#6badff",
  magenta: "#b79cff",
  cyan: "#3be1e1",
  white: "#c9ced8",
  brightBlack: "#5c6370",
  brightRed: "#ff8a8e",
  brightGreen: "#7ee8b8",
  brightYellow: "#ffd580",
  brightBlue: "#93c4ff",
  brightMagenta: "#cdb8ff",
  brightCyan: "#7aeeee",
  brightWhite: "#f2f3f6",
};

/** TunL Day — docs/03-design.md §9, column tunl-day, the sixteen ANSI colors included. */
export const TUNL_DAY: ITheme = {
  background: "#fbfbfd",
  foreground: "#1b202b",
  cursor: "#0070b0",
  cursorAccent: "#fbfbfd",
  selectionBackground: "#0070b02e",
  black: "#1b202b",
  red: "#c7282f",
  green: "#0b7a4f",
  yellow: "#9d6a00",
  blue: "#1f5fbf",
  magenta: "#7b3fd4",
  cyan: "#00798c",
  white: "#6b7280",
  brightBlack: "#4b5563",
  brightRed: "#e0474d",
  brightGreen: "#16955f",
  brightYellow: "#b98300",
  brightBlue: "#2f74d6",
  brightMagenta: "#9257e8",
  brightCyan: "#0891a8",
  brightWhite: "#9ca3af",
};

/** Search decoration colors for TunL Night. */
export const NIGHT_SEARCH: SearchColors = {
  matchBackground: "#f3c14c30",
  matchOverviewRuler: "#f3c14c",
  activeMatchBackground: "#f3c14c",
  activeMatchColorOverviewRuler: "#f3c14c",
};

/** Search decoration colors for TunL Day. */
export const DAY_SEARCH: SearchColors = {
  matchBackground: "#9d6a0030",
  matchOverviewRuler: "#9d6a00",
  activeMatchBackground: "#9d6a00",
  activeMatchColorOverviewRuler: "#9d6a00",
};

/** The SearchAddon decoration options for a theme. */
export function searchDecorations(colors: SearchColors): ISearchDecorationOptions {
  return {
    matchBackground: colors.matchBackground,
    matchOverviewRuler: colors.matchOverviewRuler,
    activeMatchBackground: colors.activeMatchBackground,
    activeMatchColorOverviewRuler: colors.activeMatchColorOverviewRuler,
  };
}

/**
 * Resolve the terminal theme. `"auto"` follows the app; an explicit choice always wins.
 * Returns the palette itself (by reference) so callers can compare it with `Object.is`.
 */
export function resolveTerminalTheme(setting: TerminalTheme, appIsDark: boolean): ITheme {
  switch (setting) {
    case "tunlNight":
      return TUNL_NIGHT;
    case "tunlDay":
      return TUNL_DAY;
    default:
      return appIsDark ? TUNL_NIGHT : TUNL_DAY;
  }
}
