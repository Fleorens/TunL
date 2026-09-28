import type { Connection } from "@/bindings/Connection";
import { compareNames } from "@/features/connections/sections";

/** The part of the day we greet with. */
export type Greeting = "morning" | "afternoon" | "evening" | "night";

/** Local hour → 5–11 morning, 12–17 afternoon, 18–22 evening, otherwise night. */
export function greetingFor(hour: number): Greeting {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 23) return "evening";
  return "night";
}

/** Favorites, sorted with `compareNames`. The input is never mutated. */
export function favoriteConnections(connections: readonly Connection[]): Connection[] {
  return [...connections]
    .filter((connection) => connection.favorite)
    .toSorted((a, b) => compareNames(a.name, b.name));
}

/**
 * Connected at least once, most recent first, at most `limit` (default 8).
 * The input is never mutated.
 */
export function recentConnections(connections: readonly Connection[], limit = 8): Connection[] {
  return [...connections]
    .filter((connection) => connection.lastConnectedAt !== null)
    .toSorted((a, b) => (b.lastConnectedAt ?? 0) - (a.lastConnectedAt ?? 0))
    .slice(0, limit);
}

/**
 * "now", "5 minutes ago", "last week"… in `locale`, using `numeric: "auto"`.
 * `d` is the gap in whole seconds (floored). A time in the future counts as now.
 */
export function formatRelativeTime(thenMs: number, nowMs: number, locale: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const d = Math.floor((nowMs - thenMs) / 1000);

  if (d < 60) return rtf.format(0, "second");
  if (d < 60 * 60) return rtf.format(-Math.floor(d / 60), "minute");
  if (d < 24 * 60 * 60) return rtf.format(-Math.floor(d / (60 * 60)), "hour");
  if (d < 7 * 24 * 60 * 60) return rtf.format(-Math.floor(d / (24 * 60 * 60)), "day");
  if (d < 30 * 24 * 60 * 60) return rtf.format(-Math.floor(d / (7 * 24 * 60 * 60)), "week");
  if (d < 365 * 24 * 60 * 60) return rtf.format(-Math.floor(d / (30 * 24 * 60 * 60)), "month");
  return rtf.format(-Math.floor(d / (365 * 24 * 60 * 60)), "year");
}

/** `user@host`, or `host`, plus `:port` when it is not the protocol's default (22, 3389). */
export function connectionAddress(connection: Connection): string {
  const defaultPort = connection.settings.protocol === "rdp" ? 3389 : 22;
  const showPort = connection.port !== defaultPort;
  const user = connection.username ? `${connection.username}@` : "";
  return `${user}${connection.host}${showPort ? `:${connection.port}` : ""}`;
}

/** The jump host's name for a connection, or `null` when it goes straight to its host. */
export function bastionName(
  connection: Connection,
  connections: readonly Connection[],
): string | null {
  if (!connection.jumpHostId) return null;
  return connections.find((other) => other.id === connection.jumpHostId)?.name ?? null;
}
