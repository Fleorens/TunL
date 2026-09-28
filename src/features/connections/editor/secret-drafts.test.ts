import { describe, expect, test } from "vitest";
import {
  secretError,
  secretKindsFor,
  secretOperations,
  secretsDirty,
  secretsValid,
  typedSecret,
  UNCHANGED_SECRETS,
  withDraft,
} from "./secret-drafts";

describe("secret drafts", () => {
  test("typing sets a draft, clearing the field keeps the keyring as is", () => {
    expect(typedSecret("hunter2")).toEqual({ action: "set", value: "hunter2" });
    expect(typedSecret("")).toEqual({ action: "keep" });
    expect(typedSecret("  spaced  ")).toEqual({ action: "set", value: "  spaced  " });
  });

  test("withDraft returns a new object and leaves the other kind alone", () => {
    const next = withDraft(UNCHANGED_SECRETS, "password", { action: "forget" });
    expect(next).not.toBe(UNCHANGED_SECRETS);
    expect(UNCHANGED_SECRETS.password).toEqual({ action: "keep" });
    expect(next.password).toEqual({ action: "forget" });
    expect(next.passphrase).toEqual({ action: "keep" });
  });

  test("dirty as soon as one draft is not keep", () => {
    expect(secretsDirty(UNCHANGED_SECRETS)).toBe(false);
    expect(secretsDirty(withDraft(UNCHANGED_SECRETS, "passphrase", typedSecret("x")))).toBe(true);
    expect(secretsDirty(withDraft(UNCHANGED_SECRETS, "password", { action: "forget" }))).toBe(true);
  });

  test("secretError flags control characters and length", () => {
    expect(secretError("")).toBeNull();
    expect(secretError("correct horse battery staple")).toBeNull();
    expect(secretError("pass\nword")).toBe("controlChars");
    expect(secretError("tab\there")).toBe("controlChars");
    expect(secretError("x".repeat(1024))).toBeNull();
    expect(secretError("x".repeat(1025))).toBe("tooLong");
  });

  test("secretsValid checks every set draft", () => {
    expect(secretsValid(UNCHANGED_SECRETS)).toBe(true);
    expect(secretsValid(withDraft(UNCHANGED_SECRETS, "password", typedSecret("ok")))).toBe(true);
    expect(secretsValid(withDraft(UNCHANGED_SECRETS, "password", typedSecret("a\rb")))).toBe(false);
  });

  test("the kinds that matter follow the protocol and the SSH method", () => {
    expect(secretKindsFor({ protocol: "ssh", sshAuthMethod: "password" })).toEqual(["password"]);
    expect(secretKindsFor({ protocol: "ssh", sshAuthMethod: "key" })).toEqual(["passphrase"]);
    expect(secretKindsFor({ protocol: "ssh", sshAuthMethod: "agent" })).toEqual([]);
    expect(secretKindsFor({ protocol: "rdp", sshAuthMethod: "key" })).toEqual(["password"]);
  });

  test("operations only for relevant kinds, keep gives nothing", () => {
    const drafts = withDraft(
      withDraft(UNCHANGED_SECRETS, "password", typedSecret("pw")),
      "passphrase",
      { action: "forget" },
    );
    expect(secretOperations(drafts, ["password"])).toEqual([
      { type: "set", kind: "password", value: "pw" },
    ]);
    expect(secretOperations(drafts, ["passphrase"])).toEqual([
      { type: "delete", kind: "passphrase" },
    ]);
    expect(secretOperations(drafts, [])).toEqual([]);
    expect(secretOperations(UNCHANGED_SECRETS, ["password", "passphrase"])).toEqual([]);
  });
});
