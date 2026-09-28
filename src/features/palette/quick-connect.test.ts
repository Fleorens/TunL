import { describe, expect, test } from "vitest";
import { formatQuickTarget, parseQuickConnect } from "./quick-connect";

describe("parseQuickConnect", () => {
  test("a bare host is SSH on port 22", () => {
    expect(parseQuickConnect("web")).toEqual({
      protocol: "ssh",
      username: null,
      host: "web",
      port: 22,
    });
  });

  test("user, host and port", () => {
    expect(parseQuickConnect("  deploy@10.0.0.5:2222 ")).toEqual({
      protocol: "ssh",
      username: "deploy",
      host: "10.0.0.5",
      port: 2222,
    });
  });

  test("port 3389 or rdp:// means RDP", () => {
    expect(parseQuickConnect("win-02:3389")?.protocol).toBe("rdp");
    expect(parseQuickConnect("RDP://admin@win-02")).toEqual({
      protocol: "rdp",
      username: "admin",
      host: "win-02",
      port: 3389,
    });
    expect(parseQuickConnect("ssh://win-02:3389")?.protocol).toBe("ssh");
  });

  test("IPv6, with or without brackets", () => {
    expect(parseQuickConnect("[::1]:2200")).toMatchObject({ host: "::1", port: 2200 });
    expect(parseQuickConnect("root@fe80::1")).toMatchObject({
      username: "root",
      host: "fe80::1",
      port: 22,
    });
    expect(parseQuickConnect("[fe80::1]")).toMatchObject({ host: "fe80::1", port: 22 });
  });

  test("what does not look like an address", () => {
    for (const input of [
      "",
      "   ",
      "two words",
      "http://web",
      "@web",
      "a@b@web",
      "web:0",
      "web:70000",
      "web:x",
      "bad_host!",
    ]) {
      expect(parseQuickConnect(input), input).toBeNull();
    }
  });
});

describe("formatQuickTarget", () => {
  test("leaves out the default port and puts IPv6 back in brackets", () => {
    expect(formatQuickTarget({ protocol: "ssh", username: "deploy", host: "web", port: 22 })).toBe(
      "deploy@web",
    );
    expect(formatQuickTarget({ protocol: "ssh", username: null, host: "web", port: 2222 })).toBe(
      "web:2222",
    );
    expect(formatQuickTarget({ protocol: "rdp", username: null, host: "win", port: 3389 })).toBe(
      "win",
    );
    expect(formatQuickTarget({ protocol: "ssh", username: null, host: "::1", port: 2200 })).toBe(
      "[::1]:2200",
    );
    expect(formatQuickTarget({ protocol: "ssh", username: null, host: "::1", port: 22 })).toBe(
      "::1",
    );
  });
});
