import { describe, expect, it } from "vitest";
import { toAppError } from "./errors";
import { ipc, isMockBackend } from "./ipc";
import { mockInvoke } from "./ipc-mock";

describe("ipc (mock backend)", () => {
  it("uses the mock outside Tauri", () => {
    expect(isMockBackend).toBe(true);
  });
  it("answers app_info", async () => {
    await expect(ipc.appInfo()).resolves.toMatchObject({ name: "TunL", version: "0.1.0-mock" });
  });
  it("rejects unknown commands with an internal AppError", async () => {
    await expect(mockInvoke("nope")).rejects.toMatchObject({ kind: "internal" });
  });
});

describe("toAppError", () => {
  it("keeps a backend AppError", () => {
    expect(toAppError({ kind: "timeout", message: "tcp", detail: null })).toEqual({
      kind: "timeout",
      message: "tcp",
      detail: null,
    });
  });
  it("wraps a JS Error", () => {
    expect(toAppError(new Error("boom"))).toEqual({
      kind: "internal",
      message: "boom",
      detail: null,
    });
  });
  it("rejects an unknown kind", () => {
    expect(toAppError({ kind: "weird", message: "x" }).kind).toBe("internal");
  });
  it("stringifies anything else", () => {
    expect(toAppError("plain")).toEqual({ kind: "internal", message: "plain", detail: null });
  });
});
