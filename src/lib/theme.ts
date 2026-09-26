import { useSyncExternalStore } from "react";

export type ThemeMode = "system" | "dark" | "light";
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
