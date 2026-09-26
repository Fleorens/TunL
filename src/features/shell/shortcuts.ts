export type ShortcutId =
  | "palette.open"
  | "palette.quickConnect"
  | "connection.new"
  | "tab.close"
  | "tab.next"
  | "tab.previous"
  | `tab.goTo${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`
  | "sidebar.toggle"
  | "sidebar.filter"
  | "settings.open"
  | "help.shortcuts";

interface KeyCombo {
  /** Compared case-insensitively with KeyboardEvent.key (layout-aware). */
  key?: string;
  /** Compared exactly with KeyboardEvent.code (physical key). Used for digits. */
  code?: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  /** When true, the combo is ignored while a terminal has focus (the shell owns it). */
  outsideTerminalOnly?: boolean;
}

export interface ShortcutDefinition {
  id: ShortcutId;
  combos: readonly KeyCombo[];
  /** Keys shown to the user, e.g. ["Ctrl", "⇧", "P"]. */
  display: readonly string[];
}

const goToTab = (n: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9): ShortcutDefinition => ({
  id: `tab.goTo${n}`,
  combos: [{ code: `Digit${n}`, alt: true }],
  display: ["Alt", String(n)],
});

export const SHORTCUTS: readonly ShortcutDefinition[] = [
  {
    id: "palette.open",
    combos: [
      { key: "p", ctrl: true, shift: true },
      { key: "k", ctrl: true, outsideTerminalOnly: true },
    ],
    display: ["Ctrl", "⇧", "P"],
  },
  {
    id: "palette.quickConnect",
    combos: [{ key: "t", ctrl: true, shift: true }],
    display: ["Ctrl", "⇧", "T"],
  },
  {
    id: "connection.new",
    combos: [{ key: "n", ctrl: true, shift: true }],
    display: ["Ctrl", "⇧", "N"],
  },
  { id: "tab.close", combos: [{ key: "w", ctrl: true, shift: true }], display: ["Ctrl", "⇧", "W"] },
  {
    id: "tab.next",
    combos: [
      { key: "PageDown", ctrl: true },
      { key: "Tab", ctrl: true },
    ],
    display: ["Ctrl", "PgDn"],
  },
  {
    id: "tab.previous",
    combos: [
      { key: "PageUp", ctrl: true },
      { key: "Tab", ctrl: true, shift: true },
    ],
    display: ["Ctrl", "PgUp"],
  },
  goToTab(1),
  goToTab(2),
  goToTab(3),
  goToTab(4),
  goToTab(5),
  goToTab(6),
  goToTab(7),
  goToTab(8),
  goToTab(9),
  {
    id: "sidebar.toggle",
    combos: [{ key: "b", ctrl: true, shift: true }],
    display: ["Ctrl", "⇧", "B"],
  },
  {
    id: "sidebar.filter",
    combos: [{ key: "e", ctrl: true, shift: true }],
    display: ["Ctrl", "⇧", "E"],
  },
  { id: "settings.open", combos: [{ key: ",", ctrl: true }], display: ["Ctrl", ","] },
  { id: "help.shortcuts", combos: [{ key: "F1" }], display: ["F1"] },
];

type KeyInfo = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">;

function comboMatches(combo: KeyCombo, event: KeyInfo, inTerminal: boolean): boolean {
  if (combo.outsideTerminalOnly && inTerminal) return false;
  if (event.metaKey) return false;
  if (event.ctrlKey !== Boolean(combo.ctrl)) return false;
  if (event.shiftKey !== Boolean(combo.shift)) return false;
  if (event.altKey !== Boolean(combo.alt)) return false;
  if (combo.code !== undefined) return event.code === combo.code;
  return combo.key !== undefined && event.key.toLowerCase() === combo.key.toLowerCase();
}

export function matchShortcut(event: KeyInfo, inTerminal: boolean): ShortcutId | null {
  const found = SHORTCUTS.find((shortcut) =>
    shortcut.combos.some((combo) => comboMatches(combo, event, inTerminal)),
  );
  return found?.id ?? null;
}
