import { afterEach, describe, expect, it } from "vitest";
import { primeTheme, resolveTheme } from "@/lib/theme";

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

describe("primeTheme", () => {
  afterEach(() => {
    document.documentElement.classList.remove("dark");
    document.documentElement.style.colorScheme = "";
  });

  it("applies a fixed theme synchronously", () => {
    primeTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
    primeTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("freezes transitions only for the duration of a switch", async () => {
    primeTheme("dark");
    expect(document.documentElement.classList.contains("theme-switching")).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(document.documentElement.classList.contains("theme-switching")).toBe(false);
  });
});
