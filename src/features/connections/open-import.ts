import { notifyComingSoon } from "@/features/shell/coming-soon";

/**
 * Entry point to import a `~/.ssh/config` file. Until T15b: `notifyComingSoon()`.
 *
 * The palette's "Import ~/.ssh/config" action calls this so there is a single place that decides
 * what importing does; T15b replaces the body without touching the callers.
 */
export function openImport(): void {
  notifyComingSoon();
}
