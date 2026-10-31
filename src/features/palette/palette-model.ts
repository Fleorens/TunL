import { normalizeForSearch } from "@/features/connections/filter";
import { SHORTCUTS, type ShortcutId } from "@/features/shell/shortcuts";
import { resolveTheme, type ThemeMode } from "@/lib/theme";

/** The palette's fixed actions, in display order, with the shortcut shown next to each. */
export const PALETTE_ACTIONS: readonly { id: PaletteActionId; shortcut: ShortcutId | null }[] = [
  { id: "newConnection", shortcut: "connection.new" },
  { id: "importSshConfig", shortcut: null },
  { id: "toggleTheme", shortcut: null },
  { id: "shortcuts", shortcut: "help.shortcuts" },
  { id: "settings", shortcut: "settings.open" },
];

/** The palette's fixed actions, in display order. */
export type PaletteActionId =
  | "newConnection"
  | "importSshConfig"
  | "toggleTheme"
  | "shortcuts"
  | "settings";

/**
 * Actions whose translated label contains every search term (`normalizeForSearch`); all of them for `""`.
 */
/** Whether every term of `search` appears in `label` (accents and case ignored); an empty search matches all. */
export function matchesSearch(label: string, search: string): boolean {
  const terms = normalizeForSearch(search).split(/\s+/).filter(Boolean);
  return terms.every((term) => normalizeForSearch(label).includes(term));
}

export function filterActions(
  labels: Record<PaletteActionId, string>,
  search: string,
): PaletteActionId[] {
  return PALETTE_ACTIONS.filter((action) => matchesSearch(labels[action.id], search)).map(
    (action) => action.id,
  );
}

/** Toggle between the two resolved themes: a dark one goes to "light", a light one to "dark". */
export function nextTheme(mode: ThemeMode, systemPrefersDark: boolean): ThemeMode {
  return resolveTheme(mode, systemPrefersDark) === "dark" ? "light" : "dark";
}

/**
 * Rows of the F1 dialog: every shortcut except `tab.goTo2`…`tab.goTo8`, with `tab.goTo1` folded into a
 * single `["Alt", "1…8"]` row and `tab.goTo9` kept as-is.
 */
export function shortcutRows(): { id: ShortcutId; display: readonly string[] }[] {
  const keep = (id: ShortcutId) =>
    !(id.startsWith("tab.goTo") && id !== "tab.goTo1" && id !== "tab.goTo9");
  return SHORTCUTS.filter((shortcut) => keep(shortcut.id)).map((shortcut) =>
    shortcut.id === "tab.goTo1"
      ? { id: "tab.goTo1", display: ["Alt", "1…8"] }
      : { id: shortcut.id, display: shortcut.display },
  );
}
