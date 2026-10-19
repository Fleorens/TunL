// T25: the explorer's order, path pieces, sizes and modes.
import { describe, expect, test } from "vitest";
import type { RemoteEntry } from "@/bindings/RemoteEntry";
import {
  DEFAULT_SORT,
  formatMode,
  formatSize,
  nextSort,
  parentPath,
  pathSegments,
  visibleEntries,
} from "./sftp-model";

function entry(name: string, kind: RemoteEntry["kind"], size = 0, modifiedAt = 0): RemoteEntry {
  return {
    name,
    path: `/srv/${name}`,
    kind,
    size,
    modifiedAt,
    permissions: 0o644,
    hidden: name.startsWith("."),
  };
}

const entries = [
  entry("b.txt", "file", 300, 3),
  entry("file10", "file", 10, 1),
  entry("Zeta", "dir", 4096, 2),
  entry(".env", "file", 5, 9),
  entry("alpha", "dir", 4096, 5),
  entry("file2", "file", 20, 8),
  entry("current", "symlink", 8, 4),
];

const names = (list: RemoteEntry[]) => list.map((e) => e.name);

describe("visibleEntries", () => {
  test("directories first, then names in natural order, hidden ones out", () => {
    expect(names(visibleEntries(entries, DEFAULT_SORT, false))).toEqual([
      "alpha",
      "Zeta",
      "b.txt",
      "current",
      "file2",
      "file10",
    ]);
  });

  test("hidden entries come back with showHidden", () => {
    expect(names(visibleEntries(entries, DEFAULT_SORT, true))).toContain(".env");
  });

  test("a descending sort keeps directories first", () => {
    const bySizeDown = visibleEntries(entries, { key: "size", ascending: false }, false);
    expect(names(bySizeDown)).toEqual(["alpha", "Zeta", "b.txt", "file2", "file10", "current"]);
    const byDate = visibleEntries(entries, { key: "modified", ascending: true }, false);
    expect(names(byDate)).toEqual(["Zeta", "alpha", "file10", "b.txt", "current", "file2"]);
  });

  test("does not touch its input", () => {
    const before = names(entries);
    visibleEntries(entries, { key: "size", ascending: false }, true);
    expect(names(entries)).toEqual(before);
  });
});

describe("nextSort", () => {
  test("the same column flips, another starts ascending", () => {
    expect(nextSort(DEFAULT_SORT, "name")).toEqual({ key: "name", ascending: false });
    expect(nextSort({ key: "name", ascending: false }, "size")).toEqual({
      key: "size",
      ascending: true,
    });
  });
});

describe("paths", () => {
  test("segments of a path", () => {
    expect(pathSegments("/var/www/html")).toEqual([
      { name: "/", path: "/" },
      { name: "var", path: "/var" },
      { name: "www", path: "/var/www" },
      { name: "html", path: "/var/www/html" },
    ]);
    expect(pathSegments("/")).toEqual([{ name: "/", path: "/" }]);
  });

  test("the parent of a path", () => {
    expect(parentPath("/var/www/html")).toBe("/var/www");
    expect(parentPath("/var/www/")).toBe("/var");
    expect(parentPath("/var")).toBe("/");
    expect(parentPath("/")).toBe("/");
  });
});

describe("formatSize", () => {
  test("bytes, then powers of 1024 with one decimal under 10", () => {
    expect(formatSize(0, "en")).toBe("0 B");
    expect(formatSize(1023, "en")).toBe("1,023 B");
    expect(formatSize(4321, "en")).toBe("4.2 KB");
    expect(formatSize(734_003_200, "en")).toBe("700 MB");
    expect(formatSize(4321, "fr")).toBe("4,2 KB");
  });
});

describe("formatMode", () => {
  test("the usual modes", () => {
    expect(formatMode("dir", 0o755)).toBe("drwxr-xr-x");
    expect(formatMode("file", 0o644)).toBe("-rw-r--r--");
    expect(formatMode("symlink", 0o777)).toBe("lrwxrwxrwx");
    expect(formatMode("file", 0o600)).toBe("-rw-------");
  });

  test("setuid, setgid, sticky, with and without execute", () => {
    expect(formatMode("file", 0o4755)).toBe("-rwsr-xr-x");
    expect(formatMode("file", 0o2644)).toBe("-rw-r-Sr--");
    expect(formatMode("dir", 0o1777)).toBe("drwxrwxrwt");
    expect(formatMode("dir", 0o1776)).toBe("drwxrwxrwT");
  });

  test("an unknown mode", () => {
    expect(formatMode("other", null)).toBe("?---------");
  });
});
