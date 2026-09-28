import type { Protocol } from "@/bindings/Protocol";
import { isValidHost } from "@/features/connections/editor/validation";

/** A connection target typed on the fly, or parsed from a `scheme://` address. */
export interface QuickTarget {
  protocol: Protocol;
  username: string | null;
  host: string;
  port: number;
}

/**
 * `[ssh://|rdp://][user@]host[:port]`. IPv6 goes in brackets (`[::1]:2222`) when a port follows, or bare
 * without one. Returns `null` on any malformed address.
 */
export function parseQuickConnect(input: string): QuickTarget | null {
  const value = input.trim();
  if (value === "" || value.includes(" ")) return null;

  // Scheme: `ssh://` or `rdp://`, case-insensitive; any other `scheme://` is rejected.
  let protocol: Protocol | null = null;
  let rest = value;
  const scheme = /([a-z]+):\/\//i.exec(value);
  if (scheme) {
    const name = scheme[1].toLowerCase();
    if (name !== "ssh" && name !== "rdp") return null;
    protocol = name;
    rest = value.slice(scheme[0].length);
  }

  // At most one `@`, with a non-empty user before it.
  let username: string | null = null;
  const at = rest.indexOf("@");
  if (at !== -1) {
    if (rest.indexOf("@", at + 1) !== -1) return null;
    username = rest.slice(0, at);
    if (username === "") return null;
    rest = rest.slice(at + 1);
  }

  // Host and optional port: brackets for `[v6]`, one colon for `host:port`, more for a bare IPv6.
  let host = rest;
  let port: number | null = null;
  const colons = rest.split(":");
  if (rest.startsWith("[")) {
    const close = rest.indexOf("]");
    if (close === -1) return null;
    host = rest.slice(1, close);
    const tail = rest.slice(close + 1);
    if (tail !== "") {
      if (!tail.startsWith(":")) return null;
      port = parsePort(tail.slice(1));
      if (port === null) return null;
    }
  } else if (colons.length === 2) {
    host = colons[0];
    port = parsePort(colons[1]);
    if (port === null) return null;
  }

  if (!isValidHost(host)) return null;

  const resolvedProtocol = protocol ?? (port === 3389 ? "rdp" : "ssh");
  const resolvedPort = port ?? (resolvedProtocol === "rdp" ? 3389 : 22);
  return { protocol: resolvedProtocol, username, host, port: resolvedPort };
}

/** A whole number between 1 and 65535, or `null` (empty and non-digits fail too). */
function parsePort(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const number = Number(value);
  return number >= 1 && number <= 65535 ? number : null;
}

/**
 * `user@host:port`, leaving out the port when it is the protocol's default. IPv6 goes back in brackets
 * only when a port follows.
 */
export function formatQuickTarget(target: QuickTarget): string {
  const defaultPort = target.protocol === "rdp" ? 3389 : 22;
  const showPort = target.port !== defaultPort;
  const host = showPort && target.host.includes(":") ? `[${target.host}]` : target.host;
  return `${target.username ? `${target.username}@` : ""}${host}${showPort ? `:${target.port}` : ""}`;
}
