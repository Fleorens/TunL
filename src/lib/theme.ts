import { useSyncExternalStore } from "react";

import type { ThemeMode } from "@/bindings/ThemeMode";

export type { ThemeMode };
export type ResolvedTheme = "dark" | "light";

const DARK_QUERY = "(prefers-color-scheme: dark)";

export function resolveTheme(mode: ThemeMode, systemPrefersDark: boolean): ResolvedTheme {
  if (mode === "system") {
    return systemPrefersDark ? "dark" : "light";
  }
  return mode;
}

function setDocumentTheme(theme: ResolvedTheme): void {
  const root = document.documentElement;
  if (root.classList.contains("dark") === (theme === "dark") && root.style.colorScheme === theme) {
    return;
  }
  // Freeze CSS transitions while switching, otherwise components with `transition-all`
  // (shadcn buttons…) animate from the old palette and show a half-switched frame.
  root.classList.add("theme-switching");
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
  void window.getComputedStyle(root).colorScheme; // flush styles while transitions are off
  window.setTimeout(() => root.classList.remove("theme-switching"), 1);
}

/** Applies the theme synchronously, without following the system. Call once before the first render. */
export function primeTheme(mode: ThemeMode): void {
  setDocumentTheme(resolveTheme(mode, window.matchMedia(DARK_QUERY).matches));
}

/** Applies the theme now and follows the system while mode is "system". Returns a cleanup function. */
export function applyTheme(mode: ThemeMode): () => void {
  const media = window.matchMedia(DARK_QUERY);
  setDocumentTheme(resolveTheme(mode, media.matches));
  if (mode !== "system") {
    return () => {};
  }
  const onChange = (event: MediaQueryListEvent) => {
    setDocumentTheme(event.matches ? "dark" : "light");
  };
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function subscribe(onStoreChange: () => void): () => void {
  const observer = new MutationObserver(onStoreChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

function getSnapshot(): ResolvedTheme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/** The theme currently applied to <html>, kept in sync with applyTheme(). */
export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribe, getSnapshot, () => "dark");
}

/** The localStorage key for the user's remembered theme mode. Not a secret (S1). */
export const THEME_STORAGE_KEY = "tunl.themeMode";

/**
 * The mode previously chosen by the user, or "system" when it is absent, unreadable, or
 * localStorage itself is unavailable. Used before the settings store loads, to avoid a flash.
 */
export function readStoredThemeMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "system" || stored === "dark" || stored === "light") {
      return stored;
    }
    return "system";
  } catch {
    // WebKitGTK can reject localStorage access; the "system" default is harmless here.
    return "system";
  }
}

/** Remember the user's theme choice. Silently ignores an unavailable localStorage. */
export function rememberThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // No persistence is acceptable: the choice is re-read as "system" next time, with no visible harm.
  }
}
