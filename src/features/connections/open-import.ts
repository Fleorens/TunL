import { useUi } from "@/features/shell/ui-store";

/**
 * Entry point to import a `~/.ssh/config` file.
 *
 * The palette, sidebar, and home screen all call this so there is a single place that decides
 * what importing does; T15b opened the real dialog here without touching the callers.
 */
export function openImport(): void {
  useUi.getState().openImport();
}
