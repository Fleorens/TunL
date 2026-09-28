import { describe, expect, test } from "vitest";
import {
  filterActions,
  nextTheme,
  PALETTE_ACTIONS,
  type PaletteActionId,
  shortcutRows,
} from "./palette-model";

const LABELS: Record<PaletteActionId, string> = {
  newConnection: "New connection",
  importSshConfig: "Import ~/.ssh/config",
  toggleTheme: "Toggle theme",
  shortcuts: "Keyboard shortcuts",
  settings: "Settings",
};

describe("palette actions", () => {
  test("keep their display order and shortcuts", () => {
    expect(PALETTE_ACTIONS.map((action) => action.id)).toEqual([
      "newConnection",
      "importSshConfig",
      "toggleTheme",
      "shortcuts",
      "settings",
    ]);
    expect(PALETTE_ACTIONS[0].shortcut).toBe("connection.new");
    expect(PALETTE_ACTIONS[3].shortcut).toBe("help.shortcuts");
  });

  test("an empty search shows every action", () => {
    expect(filterActions(LABELS, "")).toHaveLength(5);
  });

  test("every term must match, case and accents aside", () => {
    expect(filterActions(LABELS, "THEME")).toEqual(["toggleTheme"]);
    expect(filterActions(LABELS, "new conn")).toEqual(["newConnection"]);
    expect(filterActions(LABELS, "ssh")).toEqual(["importSshConfig"]);
    expect(filterActions({ ...LABELS, settings: "Paramètres" }, "parametres")).toEqual([
      "settings",
    ]);
    expect(filterActions(LABELS, "nothing here")).toEqual([]);
  });
});

describe("nextTheme", () => {
  test("switches the resolved theme", () => {
    expect(nextTheme("dark", false)).toBe("light");
    expect(nextTheme("light", true)).toBe("dark");
    expect(nextTheme("system", true)).toBe("light");
    expect(nextTheme("system", false)).toBe("dark");
  });
});

describe("shortcutRows", () => {
  test("folds Alt+1…8 into one row and keeps the last-tab shortcut", () => {
    const rows = shortcutRows();
    const ids = rows.map((row) => row.id);
    expect(ids).toContain("palette.open");
    expect(ids).toContain("tab.goTo1");
    expect(ids).toContain("tab.goTo9");
    expect(ids).not.toContain("tab.goTo2");
    expect(ids).not.toContain("tab.goTo8");
    expect(rows.find((row) => row.id === "tab.goTo1")?.display).toEqual(["Alt", "1…8"]);
  });
});
