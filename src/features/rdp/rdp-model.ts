// What the RDP card reads from FreeRDP 3: why a session ended (its exit code), the bastion tunnel's local address,
// and how long it ran. Pure: no I/O, no React (T28b).

/** Why a FreeRDP 3 session ended, grouped from its exit code (the same codes for its SDL and X11 clients). */
export type ExitKey =
  | "ended"
  | "timeout"
  | "replaced"
  | "denied"
  | "license"
  | "unreachable"
  | "dns"
  | "credentials"
  | "account"
  | "passwordExpired"
  | "tls"
  | "cancelled"
  | "arguments"
  | "unknown";

/**
 * A FreeRDP 3 exit code, into the reason it means. Ranges first (a run of codes shares one meaning), then the
 * individual codes; any other code, and `null`, is `unknown`.
 */
export function exitKey(code: number | null): ExitKey {
  if (code === null) return "unknown";
  if (code >= 16 && code <= 26) return "license";
  switch (code) {
    case 0:
    case 1:
    case 2:
    case 11:
    case 12:
      return "ended";
    case 3:
    case 4:
      return "timeout";
    case 5:
      return "replaced";
    case 7:
    case 8:
    case 9:
    case 144:
    case 155:
    case 158:
      return "denied";
    case 131:
    case 141:
    case 142:
    case 147:
      return "unreachable";
    case 139:
    case 140:
      return "dns";
    case 132:
    case 134:
    case 154:
    case 159:
      return "credentials";
    case 135:
    case 151:
    case 156:
    case 157:
      return "account";
    case 148:
    case 149:
    case 152:
      return "passwordExpired";
    case 143:
      return "tls";
    case 145:
      return "cancelled";
    case 128:
      return "arguments";
  }
  return "unknown";
}

/** The bastion tunnel's local address, from the backend's log line (`tunnel 127.0.0.1:<port> …`), or null. */
export function tunnelAddress(log: readonly string[]): string | null {
  const line = log.find((entry) => entry.startsWith("tunnel 127.0.0.1:"));
  if (!line) return null;
  const match = line.match(/^tunnel (127\.0\.0\.1):(\d+)/);
  return match ? `${match[1]}:${match[2]}` : null;
}

/** Whole minutes since `since` (ms), never negative (a clock that runs back does not show a negative duration). */
export function minutesSince(since: number, now: number): number {
  return Math.max(0, Math.floor((now - since) / 60_000));
}
