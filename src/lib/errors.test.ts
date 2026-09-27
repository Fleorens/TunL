import { describe, expect, it } from "vitest";
import { describeError } from "./errors";
import "@/i18n";

describe("describeError", () => {
  it("lists the connections that block a delete", () => {
    const error = {
      kind: "inUse" as const,
      message: "connection is used as a jump host",
      detail: { type: "inUse" as const, names: ["web-01", "web-02"] },
    };
    expect(describeError(error)).toEqual({
      title: "Still in use",
      description: "Used by: web-01, web-02",
    });
  });

  it("falls back to the technical message", () => {
    const error = { kind: "timeout" as const, message: "tcp connect", detail: null };
    expect(describeError(error)).toEqual({ title: "Timed out", description: "tcp connect" });
  });
});
