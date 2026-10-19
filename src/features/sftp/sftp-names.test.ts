// isValidName and joinPath (T25b): the same name rule as `valid_name` on the server.
import { describe, expect, it } from "vitest";
import { isValidName, joinPath } from "./sftp-model";

describe("isValidName", () => {
  it("refuses empty, dot, dot-dot, a slash and a NUL", () => {
    for (const name of ["", ".", "..", "a/b", "a\0b"]) expect(isValidName(name)).toBe(false);
  });

  it("accepts an ordinary or hidden name", () => {
    expect(isValidName("reports")).toBe(true);
    expect(isValidName(".bashrc")).toBe(true);
  });
});

describe("joinPath", () => {
  it("does not double the root's slash", () => {
    expect(joinPath("/", "a")).toBe("/a");
    expect(joinPath("/home", "a")).toBe("/home/a");
  });
});
