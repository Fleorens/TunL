// Save one change to the settings, at once, without a Save button (docs: each change applies on change).
import type { Settings } from "@/bindings/Settings";
import { notifyError } from "@/lib/errors";
import { useSettings } from "./store";

/**
 * Persist one change to the settings. Returns whether the backend accepted it: nothing before the
 * settings load, otherwise `update(change(current))`, showing a translated toast on a refusal.
 */
export function saveSettings(change: (current: Settings) => Settings): Promise<boolean> {
  const settings = useSettings.getState().settings;
  if (!settings) return Promise.resolve(false);
  return useSettings
    .getState()
    .update(change(settings))
    .then((result) => {
      if (!result.ok) notifyError(result.error);
      return result.ok;
    });
}
