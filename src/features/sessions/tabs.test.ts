// T31: the tab row with the Settings tab — order, keyboard walk, and the tab shown after a close.
import { describe, expect, test } from "vitest";
import { newSession } from "./session-model";
import { neighbourTab, relativeTab, SETTINGS_TAB, tabIds } from "./tabs";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const sessions = [A, B].map((id) => newSession(id, id, { type: "saved", connectionId: id }));

describe("tabIds", () => {
  test("the sessions in order, then Settings when it is open", () => {
    expect(tabIds(sessions, false)).toEqual([A, B]);
    expect(tabIds(sessions, true)).toEqual([A, B, SETTINGS_TAB]);
    expect(tabIds([], true)).toEqual([SETTINGS_TAB]);
    expect(tabIds([], false)).toEqual([]);
  });
});

describe("relativeTab", () => {
  test("walks the row both ways and wraps around", () => {
    const ids = tabIds(sessions, true);
    expect(relativeTab(ids, B, 1)).toBe(SETTINGS_TAB);
    expect(relativeTab(ids, SETTINGS_TAB, 1)).toBe(A);
    expect(relativeTab(ids, A, -1)).toBe(SETTINGS_TAB);
  });

  test("no tab: nothing; no active tab: the first or the last", () => {
    expect(relativeTab([], null, 1)).toBeNull();
    expect(relativeTab([A, B], null, 1)).toBe(A);
    expect(relativeTab([A, B], null, -1)).toBe(B);
  });
});

describe("neighbourTab", () => {
  test("the tab after the closed one, else the one before, else none", () => {
    expect(neighbourTab([A, B, SETTINGS_TAB], A)).toBe(B);
    expect(neighbourTab([A, B, SETTINGS_TAB], SETTINGS_TAB)).toBe(B);
    expect(neighbourTab([SETTINGS_TAB], SETTINGS_TAB)).toBeNull();
    expect(neighbourTab([A], "unknown")).toBeNull();
  });
});
