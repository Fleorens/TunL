// T58 review: a backslash stays literal in fish too, and a path with a control character is spotted.
import { describe, expect, test } from "vitest";
import { cdCommand, hasControlChar, shellQuote } from "./shell-quote";

describe("backslashes", () => {
  test("a backslash is written between double quotes, outside the single quotes", () => {
    expect(shellQuote("a\\b")).toBe(`'a'"\\\\"'b'`);
    expect(shellQuote("end\\")).toBe(`'end'"\\\\"''`);
  });

  test("a backslash before a quote cannot reopen the line in fish", () => {
    expect(shellQuote("x\\'; rm -rf ~; echo '")).toBe(`'x'"\\\\"''\\''; rm -rf ~; echo '\\'''`);
  });
});

describe("hasControlChar", () => {
  test("C0, DEL and C1 characters are spotted", () => {
    for (const ch of ["\u0000", "\n", "\r", "\u0003", "\u0015", "\u001b", "\u007f", "\u009b"]) {
      expect(hasControlChar(`/tmp/${ch}echo INJECTED #`)).toBe(true);
    }
  });

  test("an ordinary path, spaces and accents included, has none", () => {
    expect(hasControlChar("/srv/my files/été 2026")).toBe(false);
    expect(hasControlChar("/home/o'neil/$HOME/`id`")).toBe(false);
    expect(cdCommand("/srv/été")).toBe("cd '/srv/été'\r");
  });
});
