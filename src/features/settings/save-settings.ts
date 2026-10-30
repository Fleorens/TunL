// Save one change to the settings, at once, without a Save button (docs: each change applies on change).
// Changes are queued: each is computed on the last requested state (the previous change included, even if
// not yet confirmed), sent after the previous one finishes, and a refusal reverts to the last confirmed state.
import type { Settings } from "@/bindings/Settings";
import { notifyError } from "@/lib/errors";
import { useSettings } from "./store";

// The last requested state, or null when nothing is pending (the store then holds the last confirmed state).
let requested: Settings | null = null;
// The chain of sends, so each change starts only after the previous one has finished.
let chain: Promise<unknown> = Promise.resolve();

/**
 * Persist one change to the settings. Returns whether the backend accepted it: nothing before the
 * settings load, otherwise the change is queued (computed on the last requested state) and sent after the
 * previous change, showing a translated toast on a refusal.
 */
export function saveSettings(change: (current: Settings) => Settings): Promise<boolean> {
  const base = requested ?? useSettings.getState().settings;
  if (!base) return Promise.resolve(false);

  const next = change(base);
  requested = next;

  const done = chain.then(() => send(next));
  // Keep the chain alive even if a step refuses, so later changes still run.
  chain = done.catch(() => {});
  return done;
}

async function send(next: Settings): Promise<boolean> {
  const result = await useSettings.getState().update(next);
  if (result.ok) return true;
  // Refused: the state reverts to the last confirmed one.
  requested = useSettings.getState().settings;
  notifyError(result.error);
  return false;
}
