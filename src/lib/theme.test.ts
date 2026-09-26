import { describe, expect, it } from "vitest";
import { resolveTheme } from "@/lib/theme";

describe("resolveTheme", () => {
  it("follows the system when mode is system", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("ignores the system when mode is fixed", () => {
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
  });
});
