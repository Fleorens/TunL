// T28b: what the RDP card reads from FreeRDP's exit code and log.
import { describe, expect, test } from "vitest";
import { exitKey, minutesSince, tunnelAddress } from "./rdp-model";

describe("exitKey", () => {
  test("the codes FreeRDP 3 documents, grouped", () => {
    expect(exitKey(0)).toBe("ended");
    expect(exitKey(11)).toBe("ended");
    expect(exitKey(131)).toBe("unreachable");
    expect(exitKey(132)).toBe("credentials");
    expect(exitKey(134)).toBe("credentials");
    expect(exitKey(140)).toBe("dns");
    expect(exitKey(143)).toBe("tls");
    expect(exitKey(145)).toBe("cancelled");
    expect(exitKey(149)).toBe("passwordExpired");
    expect(exitKey(155)).toBe("denied");
    expect(exitKey(18)).toBe("license");
  });

  test("an unknown code, or none, is unknown", () => {
    expect(exitKey(77)).toBe("unknown");
    expect(exitKey(255)).toBe("unknown");
    expect(exitKey(null)).toBe("unknown");
  });
});

describe("tunnelAddress", () => {
  test("found in the backend's tunnel line, wherever it is", () => {
    expect(
      tunnelAddress(["[INFO] hello", "tunnel 127.0.0.1:40123 → 10.0.0.5:3389", "[INFO] bye"]),
    ).toBe("127.0.0.1:40123");
  });

  test("none without a bastion, and a client line that looks alike does not count", () => {
    expect(tunnelAddress(["[INFO] connected"])).toBeNull();
    expect(tunnelAddress(["[INFO] tunnel 127.0.0.1:1 → x"])).toBeNull();
  });
});

describe("minutesSince", () => {
  test("whole minutes, never negative", () => {
    expect(minutesSince(0, 59_999)).toBe(0);
    expect(minutesSince(0, 12 * 60_000 + 5)).toBe(12);
    expect(minutesSince(1000, 0)).toBe(0);
  });
});
