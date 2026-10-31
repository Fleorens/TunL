// The explorer's pure logic: the order of the entries, the path pieces, the sizes and the permission modes.
// Pure: every function returns a new value, never mutates its input (docs/01 §6.1).
import type { EntryKind } from "@/bindings/EntryKind";
import type { RemoteEntry } from "@/bindings/RemoteEntry";

/** A column to sort the entries on, and the direction. */
export type SortKey = "name" | "size" | "modified" | "permissions";
export interface SortOrder {
  key: SortKey;
  ascending: boolean;
}

/** The default: by name, ascending. */
export const DEFAULT_SORT: SortOrder = { key: "name", ascending: true };

// Natural, case-insensitive: `file2` before `file10`, whatever the locale.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

function isDir(entry: RemoteEntry): boolean {
  return entry.kind === "dir";
}

/**
 * The entries to show: a new array, hidden ones out unless `showHidden`, directories first (both directions),
 * then the sort key, ties broken by name. Never mutates its input (`toSorted`).
 */
export function visibleEntries(
  entries: readonly RemoteEntry[],
  order: SortOrder,
  showHidden: boolean,
): RemoteEntry[] {
  const visible = entries.filter((entry) => showHidden || !entry.hidden);
  return visible.toSorted((a, b) => {
    // Directories first, whatever the direction.
    const aDir = isDir(a);
    if (aDir !== isDir(b)) return aDir ? -1 : 1;
    let main = 0;
    switch (order.key) {
      case "name":
        main = collator.compare(a.name, b.name);
        break;
      case "size":
        main = a.size - b.size;
        break;
      case "modified":
        main = (a.modifiedAt ?? 0) - (b.modifiedAt ?? 0);
        break;
      case "permissions":
        main = (a.permissions ?? 0) - (b.permissions ?? 0);
        break;
    }
    if (order.ascending === false) main = -main;
    // A tie always breaks by name, ascending, so the order is stable regardless of the column.
    return main !== 0 ? main : collator.compare(a.name, b.name);
  });
}

/** Clicking a column flips it; clicking another starts ascending. */
export function nextSort(current: SortOrder, key: SortKey): SortOrder {
  return { key, ascending: current.key === key ? !current.ascending : true };
}

/** The breadcrumb of a path: the root, then each folder with its full path. */
export function pathSegments(path: string): { name: string; path: string }[] {
  const trimmed = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  const parts = trimmed.split("/").filter((part) => part.length > 0);
  const segments: { name: string; path: string }[] = [{ name: "/", path: "/" }];
  let acc = "";
  for (const part of parts) {
    acc += `/${part}`;
    segments.push({ name: part, path: acc });
  }
  return segments;
}

/** The parent of a path: the trailing slash is ignored, the parent of `/` is `/`. */
export function parentPath(path: string): string {
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
  const index = trimmed.lastIndexOf("/");
  if (index <= 0) return "/";
  return trimmed.slice(0, index);
}

/** A human size: bytes grouped, then powers of 1024 with one decimal under 10 (never for bytes). */
export function formatSize(bytes: number, locale: string): string {
  const fmt = new Intl.NumberFormat(locale);
  if (bytes < 1024) return `${fmt.format(bytes)} ${UNITS[0]}`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value < 10 ? Number(value.toFixed(1)) : Math.round(value);
  return `${fmt.format(rounded)} ${UNITS[unit]}`;
}

/** One permission bit is set (read, write, execute). */
function has(bits: number, value: number): boolean {
  return (bits & value) !== 0;
}

/** The three permission chars of one group: `r`, `w`, then `x` or the setuid/setgid/sticky letter. */
function groupChars(bits: number, special: boolean, letter: "s" | "t"): string {
  const read = has(bits, 4);
  const write = has(bits, 2);
  const exec = has(bits, 1);
  const execChar = exec ? (special ? letter : "x") : special ? letter.toUpperCase() : "-";
  return `${read ? "r" : "-"}${write ? "w" : "-"}${execChar}`;
}

/**
 * A name valid on the server: not empty, not `.` or `..`, no `/`, no `\0`. The same rule as `valid_name` in Rust
 * (docs/06 S11). A name is only checked against this, never mutated before it goes up.
 */
export function isValidName(name: string): boolean {
  return (
    name.length > 0 && name !== "." && name !== ".." && !name.includes("/") && !name.includes("\0")
  );
}

/** One path from a folder and a name: the root's single `/` is not doubled (`/` + `a` → `/a`). */
export function joinPath(dir: string, name: string): string {
  return dir === "/" ? `/${name}` : `${dir}/${name}`;
}

/**
 * What the menu can download. A link behaves like its target (T48): a link to a file downloads, a link to a folder or a
 * broken link does not. A file, an unknown entry, or a folder (whole, T55) downloads.
 */
export function isDownloadable(entry: RemoteEntry): boolean {
  if (entry.kind === "file" || entry.kind === "other" || entry.kind === "dir") return true;
  return entry.kind === "symlink" && entry.targetKind === "file";
}

/** The `drwxr-xr-x` mode: a type char first, then the three permission groups. `null` is an unknown mode. */
export function formatMode(kind: EntryKind, permissions: number | null): string {
  const typeChar = kind === "dir" ? "d" : kind === "symlink" ? "l" : kind === "file" ? "-" : "?";
  if (permissions === null) return `${typeChar}---------`;
  const bits = permissions & 0o777;
  const owner = groupChars(bits >> 6, has(permissions, 0o4000), "s");
  const group = groupChars(bits >> 3, has(permissions, 0o2000), "s");
  const other = groupChars(bits, has(permissions, 0o1000), "t");
  return `${typeChar}${owner}${group}${other}`;
}
