// T34: which key moves where in a list, and the index it lands on.
import { describe, expect, test } from "vitest";
import { listMove, moveIndex } from "./list-keys";

describe("listMove", () => {
  test("arrows along the list's direction, Home and End; nothing else", () => {
    expect(listMove("ArrowDown", "vertical")).toBe("next");
    expect(listMove("ArrowUp", "vertical")).toBe("previous");
    expect(listMove("ArrowRight", "horizontal")).toBe("next");
    expect(listMove("ArrowLeft", "horizontal")).toBe("previous");
    expect(listMove("Home", "vertical")).toBe("first");
    expect(listMove("End", "horizontal")).toBe("last");
    expect(listMove("ArrowRight", "vertical")).toBeNull();
    expect(listMove("ArrowDown", "horizontal")).toBeNull();
    expect(listMove("Enter", "vertical")).toBeNull();
  });
});

describe("moveIndex", () => {
  test("a list of rows stops at its ends", () => {
    expect(moveIndex("next", 1, 3, false)).toBe(2);
    expect(moveIndex("next", 2, 3, false)).toBe(2);
    expect(moveIndex("previous", 0, 3, false)).toBe(0);
    expect(moveIndex("first", 2, 3, false)).toBe(0);
    expect(moveIndex("last", 0, 3, false)).toBe(2);
  });

  test("the tab row wraps around", () => {
    expect(moveIndex("next", 2, 3, true)).toBe(0);
    expect(moveIndex("previous", 0, 3, true)).toBe(2);
  });

  test("nothing focused yet: next is the first, previous the last; an empty list has no index", () => {
    expect(moveIndex("next", -1, 3, false)).toBe(0);
    expect(moveIndex("previous", -1, 3, true)).toBe(2);
    expect(moveIndex("next", 0, 0, true)).toBe(-1);
  });
});
