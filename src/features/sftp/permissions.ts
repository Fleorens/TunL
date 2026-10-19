// The permissions dialog's pure logic: the three who/what bits, the octal field, and the mode between them.
// Pure: every function returns a new value, never mutates its input (docs/01 §6.1).

/** The three who: owner, group, other. */
export type Who = "owner" | "group" | "other";

/** The three what: read, write, execute. */
export type What = "read" | "write" | "execute";

/** The three who, for the dialog's rows. */
export const WHO: readonly Who[] = ["owner", "group", "other"];

/** The three what, for the dialog's columns. */
export const WHAT: readonly What[] = ["read", "write", "execute"];

// The rwx bit of one who, in the mode: read 4, write 2, execute 1, in each who's triplet (owner, group, other).
const MASK: Record<Who, Record<What, number>> = {
  owner: { read: 0o400, write: 0o200, execute: 0o100 },
  group: { read: 0o040, write: 0o020, execute: 0o010 },
  other: { read: 0o004, write: 0o002, execute: 0o001 },
};

/** One permission bit is set (read, write, execute) for one who. */
export function hasBit(mode: number, who: Who, what: What): boolean {
  return (mode & MASK[who][what]) !== 0;
}

/**
 * Flips one bit (a checkbox). The setuid / setgid / sticky bits are left alone: only the one rwx bit is XORed.
 */
export function toggleBit(mode: number, who: Who, what: What): number {
  return mode ^ MASK[who][what];
}

/** An octal mode in: 1 to 4 octal digits, spaces around allowed, `null` when invalid. */
export function parseOctal(text: string): number | null {
  const trimmed = text.trim();
  if (!/^[0-7]{1,4}$/.test(trimmed)) return null;
  return parseInt(trimmed, 8);
}

/** The octal mode out: four digits when a special bit is set, three otherwise (`"644"`, `"007"`, `"4755"`). */
export function toOctal(mode: number): string {
  const value = mode & 0o7777;
  return value >= 0o1000 ? value.toString(8).padStart(4, "0") : value.toString(8).padStart(3, "0");
}
