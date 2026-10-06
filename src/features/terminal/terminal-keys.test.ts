import { describe, expect, test } from "vitest";
import type { KeyInfo } from "@/features/shell/shortcuts";
import { isOpenableUrl, terminalKeyAction, zoomFontSize } from "./terminal-keys";

function key(
  k: string,
  mods: { ctrl?: boolean; shift?: boolean; alt?: boolean; code?: string } = {},
): KeyInfo {
  return {
    key: k,
    code: mods.code ?? "",
    ctrlKey: mods.ctrl ?? false,
    shiftKey: mods.shift ?? false,
    altKey: mods.alt ?? false,
    metaKey: false,
  };
}

describe("terminalKeyAction", () => {
  test("copy, paste and search use Ctrl+Shift, so Ctrl+C stays the shell's", () => {
    expect(terminalKeyAction(key("C", { ctrl: true, shift: true }))).toBe("copy");
    expect(terminalKeyAction(key("V", { ctrl: true, shift: true }))).toBe("paste");
    expect(terminalKeyAction(key("F", { ctrl: true, shift: true }))).toBe("search");
    expect(terminalKeyAction(key("c", { ctrl: true }))).toBeNull();
    expect(terminalKeyAction(key("v", { ctrl: true }))).toBeNull();
    expect(terminalKeyAction(key("f", { ctrl: true }))).toBeNull();
  });

  test("zoom works on QWERTY and AZERTY alike", () => {
    expect(terminalKeyAction(key("=", { ctrl: true }))).toBe("zoomIn");
    expect(terminalKeyAction(key("+", { ctrl: true, shift: true }))).toBe("zoomIn");
    expect(terminalKeyAction(key("+", { ctrl: true, code: "NumpadAdd" }))).toBe("zoomIn");
    expect(terminalKeyAction(key("-", { ctrl: true }))).toBe("zoomOut");
    expect(terminalKeyAction(key("-", { ctrl: true, code: "NumpadSubtract" }))).toBe("zoomOut");
    expect(terminalKeyAction(key("0", { ctrl: true, code: "Digit0" }))).toBe("zoomReset");
    // AZERTY: the 0 key gives "à" without Shift.
    expect(terminalKeyAction(key("à", { ctrl: true, code: "Digit0" }))).toBe("zoomReset");
    expect(terminalKeyAction(key("0", { ctrl: true, code: "Numpad0" }))).toBe("zoomReset");
  });

  test("anything else, Alt combos included, is left to xterm", () => {
    expect(terminalKeyAction(key("a"))).toBeNull();
    expect(terminalKeyAction(key("=", { ctrl: true, alt: true }))).toBeNull();
    expect(terminalKeyAction(key("C", { ctrl: true, shift: true, alt: true }))).toBeNull();
  });
});

describe("zoomFontSize", () => {
  test("one pixel per step, between 8 and 32, reset to the setting", () => {
    expect(zoomFontSize(13, "in", 13)).toBe(14);
    expect(zoomFontSize(13, "out", 13)).toBe(12);
    expect(zoomFontSize(32, "in", 13)).toBe(32);
    expect(zoomFontSize(8, "out", 13)).toBe(8);
    expect(zoomFontSize(20, "reset", 13)).toBe(13);
  });
});

describe("isOpenableUrl", () => {
  test("only http and https links open (S10)", () => {
    expect(isOpenableUrl("https://tunl.dev/docs")).toBe(true);
    expect(isOpenableUrl("http://10.0.0.5:8080/")).toBe(true);
    expect(isOpenableUrl("file:///etc/passwd")).toBe(false);
    expect(isOpenableUrl("javascript:alert(1)")).toBe(false);
    expect(isOpenableUrl("ftp://host/file")).toBe(false);
    expect(isOpenableUrl("not a url")).toBe(false);
  });
});
