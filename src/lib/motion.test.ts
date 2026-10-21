// T33: when the app reduces motion, and the class that tells the CSS.
import { afterEach, describe, expect, test } from "vitest";
import { applyReducedMotion, REDUCE_MOTION_CLASS, shouldReduceMotion } from "./motion";

afterEach(() => {
  document.documentElement.classList.remove(REDUCE_MOTION_CLASS);
});

describe("shouldReduceMotion", () => {
  test("on always, off never, system (or not loaded yet) as the system says", () => {
    expect(shouldReduceMotion("on", false)).toBe(true);
    expect(shouldReduceMotion("off", true)).toBe(false);
    expect(shouldReduceMotion("system", true)).toBe(true);
    expect(shouldReduceMotion("system", false)).toBe(false);
    expect(shouldReduceMotion(undefined, true)).toBe(true);
    expect(shouldReduceMotion(undefined, false)).toBe(false);
  });
});

describe("applyReducedMotion", () => {
  test("puts the class on <html> and takes it off", () => {
    applyReducedMotion(true);
    expect(document.documentElement.classList.contains("reduce-motion")).toBe(true);
    applyReducedMotion(false);
    expect(document.documentElement.classList.contains("reduce-motion")).toBe(false);
  });
});
