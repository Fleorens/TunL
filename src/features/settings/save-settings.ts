// Save one change to the settings, at once, without a Save button (docs: each change applies on change).
// Changes are queued: each is sent after the previous one finishes, and computed only when its turn comes, on
// the state the backend confirmed (the previous change included). A refusal leaves that confirmed state as it
// was, so a refused change never comes back with a later one, and a change saved elsewhere (the palette's
// theme, the backend's normalization) is kept.
import type { Settings } from "@/bindings/Settings";
import { notifyError } from "@/lib/errors";
import { useSettings } from "./store";

// The chain of sends, so each change starts only after the previous one has finished.
let chain: Promise<unknown> = Promise.resolve();

/**
 * Persist one change to the settings. Returns whether the backend accepted it: nothing before the
 * settings load, otherwise the change is queued, computed on the last confirmed state when its turn comes,
 * and sent, showing a translated toast on a refusal.
 */
export function saveSettings(change: (current: Settings) => Settings): Promise<boolean> {
  if (!useSettings.getState().settings) return Promise.resolve(false);

  const done = chain.then(() => send(change));
  // Keep the chain alive even if a step refuses, so later changes still run.
  chain = done.catch(() => {});
  return done;
}

async function send(change: (current: Settings) => Settings): Promise<boolean> {
  const current = useSettings.getState().settings;
  if (!current) return false;
  const result = await useSettings.getState().update(change(current));
  if (result.ok) return true;
  notifyError(result.error);
  return false;
}
