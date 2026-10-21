// T31: the choices of the Settings tab, and the font name check that mirrors the backend's.
import { describe, expect, test } from "vitest";
import { cleanFontFamily, intervalParts, withCurrent } from "./settings-options";

describe("withCurrent", () => {
  test("adds a value set by hand, in order, without duplicating an offered one", () => {
    const offered = [10, 13, 16];
    expect(withCurrent(offered, 13)).toEqual([10, 13, 16]);
    expect(withCurrent(offered, 9)).toEqual([9, 10, 13, 16]);
    expect(withCurrent(offered, 17)).toEqual([10, 13, 16, 17]);
    expect(offered).toEqual([10, 13, 16]);
  });
});

describe("cleanFontFamily", () => {
  test("trims, and refuses what the backend refuses", () => {
    expect(cleanFontFamily("  JetBrains Mono ")).toBe("JetBrains Mono");
    expect(cleanFontFamily("   ")).toBeNull();
    expect(cleanFontFamily("x".repeat(64))).toBe("x".repeat(64));
    expect(cleanFontFamily("x".repeat(65))).toBeNull();
    expect(cleanFontFamily("Mono\nInjected")).toBeNull();
    expect(cleanFontFamily("Mono\u0085")).toBeNull();
  });
});

describe("intervalParts", () => {
  test("the largest whole unit", () => {
    expect(intervalParts(15)).toEqual({ unit: "seconds", count: 15 });
    expect(intervalParts(60)).toEqual({ unit: "minutes", count: 1 });
    expect(intervalParts(900)).toEqual({ unit: "minutes", count: 15 });
    expect(intervalParts(3600)).toEqual({ unit: "hours", count: 1 });
    expect(intervalParts(90)).toEqual({ unit: "seconds", count: 90 });
  });
});
