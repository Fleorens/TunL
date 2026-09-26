import { describe, expect, it } from "vitest";
import { matchShortcut, type ShortcutId } from "./shortcuts";

interface KeyOpts {
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  code?: string;
  meta?: boolean;
}

/** Builds a KeyboardEvent-like object; all modifiers default to false. */
function key(k: string, opts: KeyOpts = {}): Parameters<typeof matchShortcut>[0] {
  return {
    key: k,
    code: opts.code ?? "",
    ctrlKey: opts.ctrl ?? false,
    shiftKey: opts.shift ?? false,
    altKey: opts.alt ?? false,
    metaKey: opts.meta ?? false,
  };
}

describe("matchShortcut", () => {
  it("Ctrl+Shift+P → palette.open", () => {
    expect(matchShortcut(key("P", { ctrl: true, shift: true }), false)).toBe("palette.open");
  });

  it("Ctrl+k → palette.open (outside terminal)", () => {
    expect(matchShortcut(key("k", { ctrl: true }), false)).toBe("palette.open");
  });

  it("Ctrl+k → null inside the terminal", () => {
    expect(matchShortcut(key("k", { ctrl: true }), true)).toBeNull();
  });

  it("Ctrl+Shift+B → sidebar.toggle (even inside the terminal)", () => {
    expect(matchShortcut(key("B", { ctrl: true, shift: true }), true)).toBe("sidebar.toggle");
  });

  it("Ctrl+b → null (B is reserved with Shift)", () => {
    expect(matchShortcut(key("b", { ctrl: true }), false)).toBeNull();
  });

  it("Alt+1 (key '&', code Digit1) → tab.goTo1 (AZERTY)", () => {
    expect(matchShortcut(key("&", { alt: true, code: "Digit1" }), false)).toBe("tab.goTo1");
  });

  it("Ctrl+PageDown → tab.next (even inside the terminal)", () => {
    expect(matchShortcut(key("PageDown", { ctrl: true }), true)).toBe("tab.next");
  });

  it("Ctrl+Tab → tab.next", () => {
    expect(matchShortcut(key("Tab", { ctrl: true }), false)).toBe("tab.next");
  });

  it("Ctrl+Shift+Tab → tab.previous", () => {
    expect(matchShortcut(key("Tab", { ctrl: true, shift: true }), false)).toBe("tab.previous");
  });

  it("F1 → help.shortcuts", () => {
    expect(matchShortcut(key("F1"), false)).toBe("help.shortcuts");
  });

  it("Ctrl+, → settings.open", () => {
    expect(matchShortcut(key(",", { ctrl: true }), false)).toBe("settings.open");
  });

  it("Ctrl+Shift+P with Meta → null", () => {
    expect(matchShortcut(key("P", { ctrl: true, shift: true, meta: true }), false)).toBeNull();
  });

  it("returns a valid shortcut id type", () => {
    const id: ShortcutId | null = matchShortcut(key("F1"), false);
    expect(id).toBe("help.shortcuts");
  });
});
