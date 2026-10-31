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

/**
 * `ids` with `id` moved to `toIndex` (clamped to the row), a new array; an unknown id gives `ids` itself.
 * The item is removed first, so inserting at the target index in the shorter array lands it there exactly.
 */
export function moveTab(ids: readonly string[], id: string, toIndex: number): readonly string[] {
  const from = ids.indexOf(id);
  if (from === -1) return ids;
  const clamped = Math.max(0, Math.min(toIndex, ids.length - 1));
  const rest = ids.filter((item, index) => index !== from);
  rest.splice(clamped, 0, id);
  return rest;
}

/** The tabs after `id` in `ids` (none when unknown or last). */
export function tabsRightOf(ids: readonly string[], id: string): string[] {
  const index = ids.indexOf(id);
  if (index === -1) return [];
  return [...ids.slice(index + 1)];
}
