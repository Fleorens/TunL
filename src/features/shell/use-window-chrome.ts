// Apply the chosen title bar to the window (T35): drop (or keep) its decorations when the setting is known or
// changes, store what the window really has, and follow its maximize state so the maximize button becomes restore.
import { useEffect } from "react";
import { useSettings } from "@/features/settings/store";
import { useUi } from "@/features/shell/ui-store";
import { notifyError } from "@/lib/errors";
import { onWindowMaximized } from "@/lib/events";
import { ipc } from "@/lib/ipc";

/** Apply the title bar setting to the window, and follow its maximize state (T35). */
export function useWindowChrome(): void {
  const titleBar = useSettings((settings) => settings.settings?.ui.titleBar);
  const setWindowChrome = useUi((state) => state.setWindowChrome);
  const setMaximized = useUi((state) => state.setMaximized);

  useEffect(() => {
    if (!titleBar) return;
    // A quick change of setting: only the answer for the latest one is kept.
    let cancelled = false;
    ipc.windowApplyTitleBar(titleBar).then((chrome) => {
      if (!cancelled) setWindowChrome(chrome);
    }, notifyError);
    return () => {
      cancelled = true;
    };
  }, [titleBar, setWindowChrome]);

  useEffect(() => onWindowMaximized(setMaximized), [setMaximized]);
}
