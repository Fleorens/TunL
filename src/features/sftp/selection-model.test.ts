// T54: the selection of the SFTP table, as paths: click, Ctrl, Shift, Ctrl+A, and what a refresh keeps.
import { describe, expect, test } from "vitest";
import {
  clickRow,
  EMPTY_SELECTION,
  extendTo,
  keepVisible,
  selectAll,
  selectOne,
  toggle,
} from "./selection-model";

const order = ["/h/projects", "/h/backup.tar.gz", "/h/current", "/h/notes.txt"];

describe("selection", () => {
  test("a click selects one row, Ctrl adds and removes", () => {
    const one = selectOne("/h/current");
    expect(one).toEqual({ paths: ["/h/current"], anchor: "/h/current", focus: "/h/current" });
    const two = toggle(one, "/h/projects");
    expect(two.paths).toEqual(["/h/current", "/h/projects"]);
    expect(two.anchor).toBe("/h/projects");
    expect(toggle(two, "/h/current").paths).toEqual(["/h/projects"]);
    expect(one.paths).toEqual(["/h/current"]);
  });

  test("Shift selects the range from the anchor, in the order shown, in both directions", () => {
    const from = selectOne("/h/backup.tar.gz");
    const down = extendTo(from, order, "/h/notes.txt");
    expect(down).toEqual({
      paths: ["/h/backup.tar.gz", "/h/current", "/h/notes.txt"],
      anchor: "/h/backup.tar.gz",
      focus: "/h/notes.txt",
    });
    expect(extendTo(down, order, "/h/projects").paths).toEqual(["/h/projects", "/h/backup.tar.gz"]);
    expect(extendTo(EMPTY_SELECTION, order, "/h/current")).toEqual(selectOne("/h/current"));
  });

  test("Ctrl+A selects every row shown", () => {
    expect(selectAll(order).paths).toEqual(order);
    expect(selectAll([])).toEqual(EMPTY_SELECTION);
  });

  test("a refresh keeps only what is still shown, and the same object when nothing changes", () => {
    const sel = toggle(selectOne("/h/notes.txt"), "/h/current");
    expect(keepVisible(sel, order)).toBe(sel);
    const kept = keepVisible(sel, ["/h/projects", "/h/notes.txt"]);
    expect(kept).toEqual({ paths: ["/h/notes.txt"], anchor: null, focus: null });
  });

  test("a click follows its modifiers", () => {
    const sel = selectOne("/h/projects");
    expect(clickRow(sel, order, "/h/current", { ctrl: false, shift: false })).toEqual(
      selectOne("/h/current"),
    );
    expect(clickRow(sel, order, "/h/current", { ctrl: true, shift: false }).paths).toEqual([
      "/h/projects",
      "/h/current",
    ]);
    expect(clickRow(sel, order, "/h/current", { ctrl: false, shift: true }).paths).toEqual([
      "/h/projects",
      "/h/backup.tar.gz",
      "/h/current",
    ]);
  });
});
