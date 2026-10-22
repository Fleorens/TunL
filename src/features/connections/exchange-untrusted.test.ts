// The import summary adds the RDP options-removed part after the invalid count, only when at least
// one connection had its extra arguments and home sharing dropped on import.
import { describe, expect, test } from "vitest";
import { importSummary } from "./exchange";

describe("importSummary", () => {
  test("the RDP options removed, after the invalid, only when at least one", () => {
    expect(
      importSummary({
        added: 1,
        skipped: 0,
        invalid: 0,
        groupsCreated: 0,
        rdpOptionsRemoved: 1,
      }),
    ).toBe(
      "1 connection added · 1 RDP connection had its extra arguments and home sharing removed",
    );
    expect(
      importSummary({
        added: 2,
        skipped: 0,
        invalid: 0,
        groupsCreated: 0,
        rdpOptionsRemoved: 2,
      }),
    ).toBe(
      "2 connections added · 2 RDP connections had their extra arguments and home sharing removed",
    );
  });

  test("without the field, the text is unchanged", () => {
    expect(importSummary({ added: 1, skipped: 0, invalid: 0, groupsCreated: 0 })).toBe(
      "1 connection added",
    );
  });
});
