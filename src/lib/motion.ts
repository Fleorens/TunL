import { useSyncExternalStore } from "react";

import type { ReduceMotion } from "@/bindings/ReduceMotion";

/** The class `useApplySettings` puts on <html> to tell the CSS to stop every animation. */
export const REDUCE_MOTION_CLASS = "reduce-motion";

const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Whether motion should be reduced. `on` → yes, `off` → no, `system` (or a value not
 * loaded yet: `undefined`) → the system preference.
 */
export function shouldReduceMotion(
  setting: ReduceMotion | undefined,
  systemPrefersReduce: boolean,
): boolean {
  if (setting === "on") return true;
  if (setting === "off") return false;
  return systemPrefersReduce;
}

/** Adds or removes the `reduce-motion` class on <html>. */
export function applyReducedMotion(reduce: boolean): void {
  document.documentElement.classList.toggle(REDUCE_MOTION_CLASS, reduce);
}

function subscribe(onStoreChange: () => void): () => void {
  const media = window.matchMedia(REDUCE_QUERY);
  media.addEventListener("change", onStoreChange);
  return () => media.removeEventListener("change", onStoreChange);
}

function getSnapshot(): boolean {
  return window.matchMedia(REDUCE_QUERY).matches;
}

/**
 * `(prefers-reduced-motion: reduce)`, followed live (`useSyncExternalStore`), `false` on the server.
 */
export function useSystemPrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** The reduced-motion verdict for the current setting, now. */
export function useReducedMotionNow(setting: ReduceMotion | undefined): boolean {
  return shouldReduceMotion(setting, useSystemPrefersReducedMotion());
}
