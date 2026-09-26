import { describe, expect, it } from "vitest";
import { detectSystemLanguage, resolveLanguage } from "./index";

describe("detectSystemLanguage", () => {
  it("returns fr when French comes first", () => {
    expect(detectSystemLanguage(["fr-FR", "en-US"])).toBe("fr");
  });

  it("falls back to en when French is absent but English is present", () => {
    expect(detectSystemLanguage(["de-DE", "en-GB"])).toBe("en");
  });

  it("falls back to en when neither French nor English is present", () => {
    expect(detectSystemLanguage(["de-DE"])).toBe("en");
  });

  it("returns en for an empty list", () => {
    expect(detectSystemLanguage([])).toBe("en");
  });
});

describe("resolveLanguage", () => {
  it("honors an explicit preference over the system", () => {
    expect(resolveLanguage("fr", ["en-US"])).toBe("fr");
  });

  it("resolves system preference to the detected language", () => {
    expect(resolveLanguage("system", ["fr-BE"])).toBe("fr");
  });
});
