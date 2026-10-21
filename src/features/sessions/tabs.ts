// The row of tabs: the sessions in order, then the Settings tab when it is open. Pure, so the
// keyboard walk and the tab shown after a close can be tested without the store.
import type { Session } from "./session-model";

/** The Settings tab id. Never a session id (those are UUIDs), so it can never collide. */
export const SETTINGS_TAB = "settings";

/** The tab row: the sessions in order, then Settings when it is open. */
export function tabIds(sessions: readonly Session[], settingsOpen: boolean): string[] {
  return settingsOpen
    ? [...sessions.map((session) => session.id), SETTINGS_TAB]
    : sessions.map((session) => session.id);
}

/**
 * The tab `delta` steps from `activeId`, walking the row and wrapping around. No tab: nothing; no
 * active tab: the first (`+1`) or the last (`-1`).
 */
export function relativeTab(
  ids: readonly string[],
  activeId: string | null,
  delta: 1 | -1,
): string | null {
  if (ids.length === 0) return null;
  if (activeId === null) return delta === 1 ? ids[0] : ids[ids.length - 1];
  const index = ids.indexOf(activeId);
  if (index === -1) return null;
  const next = (index + delta + ids.length) % ids.length;
  return ids[next] ?? null;
}

/** The tab to show when `removedId` closes: the one after it, else the one before, else none. */
export function neighbourTab(ids: readonly string[], removedId: string): string | null {
  const index = ids.indexOf(removedId);
  if (index === -1) return null;
  return ids[index + 1] ?? ids[index - 1] ?? null;
}
