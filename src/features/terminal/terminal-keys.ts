import type { KeyInfo } from "@/features/shell/shortcuts";

/** What a terminal key press does, as distinguished from the shell's own keys. */
export type TerminalKeyAction = "copy" | "paste" | "search" | "zoomIn" | "zoomOut" | "zoomReset";

/** A zoom step, relative to the terminal's own font size. */
export type ZoomAction = "in" | "out" | "reset";

/** The smallest font size a terminal zoom may reach. */
export const FONT_SIZE_MIN = 8;
/** The largest font size a terminal zoom may reach. */
export const FONT_SIZE_MAX = 32;

/**
 * The action a key press performs in the terminal, or null when it belongs to the shell (and
 * xterm should handle it). No `Alt`, no `Meta`. `Ctrl+Shift+C/V/F` are the terminal's; plain
 * `Ctrl+C/V/F` stay the shell's.
 */
export function terminalKeyAction(event: KeyInfo): TerminalKeyAction | null {
  if (event.altKey || event.metaKey) {
    return null;
  }
  if (!event.ctrlKey) {
    return null;
  }

  const { key, code, shiftKey } = event;

  // Zoom: allowed with or without Shift, on QWERTY and AZERTY alike.
  if (code === "NumpadAdd" || key === "=" || key === "+") {
    return "zoomIn";
  }
  if (code === "NumpadSubtract" || key === "-") {
    return "zoomOut";
  }
  if (code === "Digit0" || code === "Numpad0" || key === "0" || key === "à") {
    return "zoomReset";
  }

  // Copy / paste / search live behind Ctrl+Shift.
  if (shiftKey) {
    switch (key.toLowerCase()) {
      case "c":
        return "copy";
      case "v":
        return "paste";
      case "f":
        return "search";
      default:
        return null;
    }
  }

  return null;
}

/**
 * The next font size for a terminal zoom: ±1 pixel, bounded, and `reset` returns the base size.
 */
export function zoomFontSize(current: number, action: ZoomAction, base: number): number {
  if (action === "reset") {
    return base;
  }
  const next = action === "in" ? current + 1 : current - 1;
  return Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, next));
}

/**
 * Whether a URL the terminal found may be opened externally. Only `http:` and `https:`, and only
 * when the string parses as a URL (S10).
 */
export function isOpenableUrl(uri: string): boolean {
  try {
    const url = new URL(uri);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
