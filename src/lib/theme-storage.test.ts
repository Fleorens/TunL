import { afterEach, describe, expect, it } from "vitest";
import { readStoredThemeMode, rememberThemeMode, THEME_STORAGE_KEY } from "./theme";

afterEach(() => {
  localStorage.clear();
});

describe("remembered theme mode", () => {
  it("defaults to system", () => {
    expect(readStoredThemeMode()).toBe("system");
  });

  it("returns what was remembered", () => {
    rememberThemeMode("light");
    expect(readStoredThemeMode()).toBe("light");
  });

  it("ignores garbage", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "purple");
    expect(readStoredThemeMode()).toBe("system");
  });
});
