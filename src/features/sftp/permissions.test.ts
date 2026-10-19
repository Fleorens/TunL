// T25b: the permissions dialog's boxes and octal field.
import { describe, expect, test } from "vitest";
import { hasBit, parseOctal, toggleBit, toOctal } from "./permissions";

describe("permissions", () => {
  test("the boxes of 0o754", () => {
    expect(hasBit(0o754, "owner", "execute")).toBe(true);
    expect(hasBit(0o754, "group", "write")).toBe(false);
    expect(hasBit(0o754, "group", "execute")).toBe(true);
    expect(hasBit(0o754, "other", "read")).toBe(true);
    expect(hasBit(0o754, "other", "execute")).toBe(false);
  });

  test("a box flips one bit and keeps the special ones", () => {
    expect(toggleBit(0o644, "group", "write")).toBe(0o664);
    expect(toggleBit(0o664, "group", "write")).toBe(0o644);
    expect(toggleBit(0o4755, "other", "execute")).toBe(0o4754);
  });

  test("octal in and out", () => {
    expect(parseOctal("755")).toBe(0o755);
    expect(parseOctal(" 0644 ")).toBe(0o644);
    expect(parseOctal("4755")).toBe(0o4755);
    for (const bad of ["", "8", "75a", "17777", "-1", "7 5"]) expect(parseOctal(bad)).toBeNull();
    expect(toOctal(0o644)).toBe("644");
    expect(toOctal(0o7)).toBe("007");
    expect(toOctal(0o4755)).toBe("4755");
  });
});
