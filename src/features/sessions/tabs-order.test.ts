// T59: the tab row can be reordered, and "to the right" means after the tab, in the row's order.
import { describe, expect, test } from "vitest";
import { moveTab, tabsRightOf } from "./tabs";

const row = ["a", "b", "c", "d"];

describe("tab order", () => {
  test("a tab moves to an index, the others keep their order", () => {
    expect(moveTab(row, "a", 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveTab(row, "d", 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveTab(row, "b", 9)).toEqual(["a", "c", "d", "b"]);
    expect(moveTab(row, "c", -3)).toEqual(["c", "a", "b", "d"]);
    expect(row).toEqual(["a", "b", "c", "d"]);
  });

  test("an unknown tab changes nothing", () => {
    expect(moveTab(row, "z", 1)).toBe(row);
  });

  test("the tabs to the right of one", () => {
    expect(tabsRightOf(row, "b")).toEqual(["c", "d"]);
    expect(tabsRightOf(row, "d")).toEqual([]);
    expect(tabsRightOf(row, "z")).toEqual([]);
  });
});
