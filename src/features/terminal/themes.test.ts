import { describe, expect, test } from "vitest";
import { resolveTerminalTheme, TUNL_DAY, TUNL_NIGHT } from "./themes";

const ANSI = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const;

describe("terminal themes (docs/03-design.md §9)", () => {
  test("auto follows the app theme; an explicit choice wins", () => {
    expect(resolveTerminalTheme("auto", true)).toBe(TUNL_NIGHT);
    expect(resolveTerminalTheme("auto", false)).toBe(TUNL_DAY);
    expect(resolveTerminalTheme("tunlDay", true)).toBe(TUNL_DAY);
    expect(resolveTerminalTheme("tunlNight", false)).toBe(TUNL_NIGHT);
  });

  test("the palettes carry the documented values", () => {
    expect(TUNL_NIGHT).toMatchObject({
      background: "#0a0d12",
      foreground: "#e6e8ee",
      cursor: "#17cced",
      cursorAccent: "#0a0d12",
      selectionBackground: "#17cced40",
      red: "#ff6b70",
      brightWhite: "#f2f3f6",
    });
    expect(TUNL_DAY).toMatchObject({
      background: "#fbfbfd",
      foreground: "#1b202b",
      cursor: "#0070b0",
      selectionBackground: "#0070b02e",
      green: "#0b7a4f",
      brightWhite: "#9ca3af",
    });
  });

  test("both palettes define the sixteen ANSI colors", () => {
    for (const theme of [TUNL_NIGHT, TUNL_DAY]) {
      for (const color of ANSI) expect(theme[color], color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
