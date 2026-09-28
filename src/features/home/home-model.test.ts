import { describe, expect, test } from "vitest";
import type { Connection } from "@/bindings/Connection";
import { MOCK_CONNECTIONS } from "@/lib/mock/data";
import {
  connectionAddress,
  favoriteConnections,
  formatRelativeTime,
  greetingFor,
  recentConnections,
} from "./home-model";

const NOW = Date.UTC(2026, 8, 27, 12, 0, 0);
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function connection(name: string, patch: Partial<Connection> = {}): Connection {
  return { ...MOCK_CONNECTIONS[0], id: crypto.randomUUID(), name, ...patch };
}

describe("greetingFor", () => {
  test("follows the hour of the day", () => {
    expect([5, 11, 12, 17, 18, 22, 23, 0, 4].map(greetingFor)).toEqual([
      "morning",
      "morning",
      "afternoon",
      "afternoon",
      "evening",
      "evening",
      "night",
      "night",
      "night",
    ]);
  });
});

describe("favorites and recents", () => {
  test("favorites are sorted by name", () => {
    const list = [
      connection("web-10", { favorite: true }),
      connection("db", { favorite: false }),
      connection("web-2", { favorite: true }),
    ];
    expect(favoriteConnections(list).map((c) => c.name)).toEqual(["web-2", "web-10"]);
  });

  test("recents: connected at least once, most recent first, limited", () => {
    const list = [
      connection("old", { lastConnectedAt: NOW - 3 * DAY }),
      connection("never", { lastConnectedAt: null }),
      connection("fresh", { lastConnectedAt: NOW - MINUTE }),
      connection("mid", { lastConnectedAt: NOW - HOUR }),
    ];
    expect(recentConnections(list).map((c) => c.name)).toEqual(["fresh", "mid", "old"]);
    expect(recentConnections(list, 2).map((c) => c.name)).toEqual(["fresh", "mid"]);
  });

  test("at most eight recents by default", () => {
    const list = Array.from({ length: 12 }, (_, i) =>
      connection(`c${i}`, { lastConnectedAt: NOW - i * MINUTE }),
    );
    expect(recentConnections(list)).toHaveLength(8);
  });
});

describe("formatRelativeTime", () => {
  test("recent past in English", () => {
    expect(formatRelativeTime(NOW - 30 * SECOND, NOW, "en")).toBe("now");
    expect(formatRelativeTime(NOW - MINUTE, NOW, "en")).toBe("1 minute ago");
    expect(formatRelativeTime(NOW - 5 * MINUTE, NOW, "en")).toBe("5 minutes ago");
    expect(formatRelativeTime(NOW - 3 * HOUR, NOW, "en")).toBe("3 hours ago");
  });

  test("days, weeks, months, years", () => {
    expect(formatRelativeTime(NOW - 26 * HOUR, NOW, "en")).toBe("yesterday");
    expect(formatRelativeTime(NOW - 3 * DAY, NOW, "en")).toBe("3 days ago");
    expect(formatRelativeTime(NOW - 10 * DAY, NOW, "en")).toBe("last week");
    expect(formatRelativeTime(NOW - 40 * DAY, NOW, "en")).toBe("last month");
    expect(formatRelativeTime(NOW - 400 * DAY, NOW, "en")).toBe("last year");
  });

  test("French, and a future time counts as now", () => {
    expect(formatRelativeTime(NOW - 5 * MINUTE, NOW, "fr")).toBe("il y a 5 minutes");
    expect(formatRelativeTime(NOW - 26 * HOUR, NOW, "fr")).toBe("hier");
    expect(formatRelativeTime(NOW + HOUR, NOW, "en")).toBe("now");
  });
});

describe("connectionAddress", () => {
  test("leaves out what is implicit", () => {
    const ssh = MOCK_CONNECTIONS.find((c) => c.settings.protocol === "ssh") as Connection;
    const rdp = MOCK_CONNECTIONS.find((c) => c.settings.protocol === "rdp") as Connection;
    expect(connectionAddress({ ...ssh, username: "deploy", host: "10.0.0.12", port: 22 })).toBe(
      "deploy@10.0.0.12",
    );
    expect(connectionAddress({ ...ssh, username: null, host: "nas", port: 2222 })).toBe("nas:2222");
    expect(connectionAddress({ ...rdp, username: "admin", host: "win", port: 3389 })).toBe(
      "admin@win",
    );
    expect(connectionAddress({ ...rdp, username: null, host: "win", port: 22 })).toBe("win:22");
  });
});
