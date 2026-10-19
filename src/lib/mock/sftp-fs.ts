// The mock's remote file system (T24): an immutable map from absolute path to node. Every function is
// pure: it returns a new map, or throws the `AppError` the backend would return for the same request.
import type { AppError } from "@/bindings/AppError";
import type { EntryKind } from "@/bindings/EntryKind";
import type { RemoteEntry } from "@/bindings/RemoteEntry";

export interface MockNode {
  kind: EntryKind;
  size: number;
  modifiedAt: number;
  /** The permission bits only (`0o7777`). */
  permissions: number;
}

export type MockFs = ReadonlyMap<string, MockNode>;

const MTIME = Date.UTC(2026, 8, 1, 9, 30);

function validation(field: string, reason: string): AppError {
  return { kind: "validation", message: `${field}: ${reason}`, detail: null };
}

function notFound(path: string): AppError {
  return { kind: "notFound", message: path, detail: null };
}

function failed(op: string, path: string): AppError {
  return { kind: "sftp", message: `${op} failed: ${path}`, detail: null };
}

function dir(): MockNode {
  return { kind: "dir", size: 4096, modifiedAt: MTIME, permissions: 0o755 };
}

function file(size: number): MockNode {
  return { kind: "file", size, modifiedAt: MTIME, permissions: 0o644 };
}

function link(): MockNode {
  return { kind: "symlink", size: 0, modifiedAt: MTIME, permissions: 0o777 };
}

/** Same rule as the backend's `validate_remote_path`: absolute, no NUL (S11). */
function validatePath(field: string, path: string): void {
  if (!path.startsWith("/") || path.includes("\0")) {
    throw validation(field, "must be an absolute path");
  }
}

/** Resolve the empty, `.` and `..` segments of an absolute path. */
function normalize(path: string): string {
  const parts: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return `/${parts.join("/")}`;
}

function parentOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Whether `path` is `root` or lies under it. */
function within(path: string, root: string): boolean {
  return path === root || path.startsWith(root === "/" ? "/" : `${root}/`);
}

function existing(fs: MockFs, path: string): MockNode {
  const node = fs.get(path);
  if (!node) throw notFound(path);
  return node;
}

/** The demo tree, without any home directory (see `withHome`). */
export function demoFs(): MockFs {
  return new Map<string, MockNode>([
    ["/", dir()],
    ["/etc", dir()],
    ["/etc/hostname", file(12)],
    ["/home", dir()],
    ["/var", dir()],
    ["/var/log", dir()],
    ["/var/log/syslog", file(48_213)],
    ["/var/www", dir()],
    ["/var/www/html", dir()],
    ["/var/www/html/index.html", file(1_024)],
    ["/var/www/html/assets", dir()],
    ["/var/www/html/assets/app.js", file(18_432)],
  ]);
}

/** `fs` with `/home/<user>` and its demo contents, unless that home already exists. */
export function withHome(fs: MockFs, user: string): MockFs {
  const home = `/home/${user}`;
  if (fs.has(home)) return fs;
  const next = new Map(fs);
  next.set(home, { ...dir(), permissions: 0o700 });
  next.set(`${home}/.bashrc`, file(3_771));
  next.set(`${home}/notes.txt`, file(512));
  next.set(`${home}/backup.tar.gz`, file(734_003_200));
  next.set(`${home}/projects`, dir());
  next.set(`${home}/projects/README.md`, file(2_048));
  next.set(`${home}/projects/app`, dir());
  next.set(`${home}/projects/app/main.rs`, file(640));
  next.set(`${home}/current`, link());
  return next;
}

/** The canonical path: `.` (or any relative path) starts at `home`. */
export function realpath(fs: MockFs, path: string, home: string): string {
  if (path.includes("\0")) throw validation("path", "must not contain NUL");
  const absolute = path.startsWith("/") ? path : `${home}/${path}`;
  const resolved = normalize(absolute);
  existing(fs, resolved);
  return resolved;
}

/** A directory's entries, sorted by name. */
export function list(fs: MockFs, path: string): RemoteEntry[] {
  validatePath("path", path);
  const target = normalize(path);
  if (existing(fs, target).kind !== "dir") throw failed("list", path);
  const entries: RemoteEntry[] = [];
  for (const [entryPath, node] of fs) {
    if (entryPath === "/" || parentOf(entryPath) !== target) continue;
    const name = nameOf(entryPath);
    entries.push({
      name,
      path: entryPath,
      kind: node.kind,
      size: node.size,
      modifiedAt: node.modifiedAt,
      permissions: node.permissions,
      hidden: name.startsWith("."),
    });
  }
  return entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Create a directory: its parent must exist, the path must not. */
export function mkdir(fs: MockFs, path: string): MockFs {
  validatePath("path", path);
  const target = normalize(path);
  if (fs.has(target)) throw failed("mkdir", path);
  if (fs.get(parentOf(target))?.kind !== "dir") throw notFound(path);
  return new Map(fs).set(target, { ...dir(), modifiedAt: Date.now() });
}

/** Move `from` (and everything under it) to `to`, which must not exist yet. */
export function rename(fs: MockFs, from: string, to: string): MockFs {
  validatePath("from", from);
  validatePath("to", to);
  const source = normalize(from);
  const destination = normalize(to);
  existing(fs, source);
  if (fs.has(destination) || within(destination, source)) throw failed("rename", from);
  if (fs.get(parentOf(destination))?.kind !== "dir") throw notFound(to);
  const next = new Map<string, MockNode>();
  for (const [path, node] of fs) {
    const moved = within(path, source) ? destination + path.slice(source.length) : path;
    next.set(moved, node);
  }
  return next;
}

/** How many entries a removal of `path` would clear, `path` included. */
export function count(fs: MockFs, path: string): number {
  validatePath("path", path);
  const target = normalize(path);
  existing(fs, target);
  return [...fs.keys()].filter((entry) => within(entry, target)).length;
}

/** Remove `path` and everything under it; the root is refused. */
export function remove(fs: MockFs, path: string): MockFs {
  validatePath("path", path);
  const target = normalize(path);
  if (target === "/") throw validation("path", "cannot remove the root");
  existing(fs, target);
  return new Map([...fs].filter(([entry]) => !within(entry, target)));
}

/** Set a path's permission bits; a mode above `0o7777` is refused. */
export function chmod(fs: MockFs, path: string, mode: number): MockFs {
  validatePath("path", path);
  if (mode > 0o7777) throw validation("mode", "out of range");
  const target = normalize(path);
  const node = existing(fs, target);
  return new Map(fs).set(target, { ...node, permissions: mode });
}
