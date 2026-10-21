// The choices of the Settings tab, and the font-name check that mirrors the backend's (docs/05 §5).
// Pure, so the choices and the refusal can be tested without the UI.

/** The font sizes the terminal offers, in pixels. */
export const FONT_SIZES = [10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32] as const;
/** The line heights the terminal offers. */
export const LINE_HEIGHTS = [1, 1.1, 1.2, 1.25, 1.3, 1.4, 1.5, 1.75, 2] as const;
/** The scrollback amounts the terminal offers, in lines. */
export const SCROLLBACKS = [1000, 5000, 10000, 25000, 50000, 100000] as const;
/** The probe intervals the availability section offers, in seconds. */
export const PROBE_INTERVALS = [15, 30, 60, 120, 300, 900, 3600] as const;
/** The connection timeouts the SSH section offers, in seconds. */
export const CONNECT_TIMEOUTS = [5, 10, 15, 30, 60, 120] as const;
/** The keepalive intervals the SSH section offers, in seconds (0 disables it). */
export const KEEPALIVES = [0, 15, 30, 60, 120, 300] as const;
/** The longest a font name may be (the backend's limit). */
export const FONT_FAMILY_MAX = 64;

/**
 * Add a value set by hand to the offered ones, sorted, without duplicating an offered one, in a new
 * array. The offered list is never mutated.
 */
export function withCurrent<T>(options: readonly T[], current: T): T[] {
  if (options.includes(current)) return [...options];
  return [...options, current].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * The host and port as the Settings tab shows it: `host` on the default SSH port, `host:port` otherwise.
 */
export function hostLabel(host: string, port: number): string {
  return port === 22 ? host : `${host}:${port}`;
}

/**
 * The font name the backend would accept: the trimmed name, or null when it is empty, longer than
 * `FONT_FAMILY_MAX`, or holds a control character (C0, DEL, or C1) the backend refuses.
 */
export function cleanFontFamily(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > FONT_FAMILY_MAX) return null;
  for (const character of trimmed) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f || (code >= 0x80 && code <= 0x9f)) return null;
  }
  return trimmed;
}

/** The largest whole unit that divides `seconds` (hours, else minutes, else seconds). */
export function intervalParts(seconds: number): {
  unit: "seconds" | "minutes" | "hours";
  count: number;
} {
  if (seconds % 3600 === 0) return { unit: "hours", count: seconds / 3600 };
  if (seconds % 60 === 0) return { unit: "minutes", count: seconds / 60 };
  return { unit: "seconds", count: seconds };
}
