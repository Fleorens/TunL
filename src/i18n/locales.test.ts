import { describe, expect, it } from "vitest";
import en from "./locales/en.json";
import fr from "./locales/fr.json";

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function flattenKeys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) {
    return [prefix];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    flattenKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

function normalizedKeys(resource: unknown): string[] {
  return [...new Set(flattenKeys(resource).map((key) => key.replace(PLURAL_SUFFIX, "")))].sort();
}

function leafValues(value: unknown): unknown[] {
  if (typeof value !== "object" || value === null) {
    return [value];
  }
  return Object.values(value).flatMap(leafValues);
}

describe("locales", () => {
  it("en and fr define the same keys (plural variants aside)", () => {
    expect(normalizedKeys(fr)).toEqual(normalizedKeys(en));
  });

  it("has no empty or non-string translation", () => {
    for (const value of [...leafValues(en), ...leafValues(fr)]) {
      expect(typeof value).toBe("string");
      expect(String(value).trim()).not.toBe("");
    }
  });
});
