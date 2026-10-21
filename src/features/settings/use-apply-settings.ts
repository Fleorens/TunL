import { useEffect } from "react";
import { useSettings } from "@/features/settings/store";
import { setLanguage } from "@/i18n";
import { applyReducedMotion, useReducedMotionNow } from "@/lib/motion";
import { applyTheme, readStoredThemeMode, rememberThemeMode } from "@/lib/theme";

/** The values `<MotionConfig reducedMotion>` accepts. */
export type AppliedMotion = "always" | "never";

/**
 * Applies theme, language and animation settings as they load and change.
 *
 * - Theme: until settings load, use the remembered mode (no startup flash); then apply and remember.
 * - Language: switch to `settings.language`.
 * - Motion: the `reduce-motion` class drives the CSS (spinner, pulse, shadcn entry transitions);
 *   the returned value drives motion's own components.
 */
export function useApplySettings(): AppliedMotion {
  const settings = useSettings((state) => state.settings);
  const reduce = useReducedMotionNow(settings?.reduceMotion);

  useEffect(() => {
    applyReducedMotion(reduce);
  }, [reduce]);

  useEffect(() => {
    if (!settings) {
      // Settings are not loaded yet: fall back to the remembered mode.
      applyTheme(readStoredThemeMode());
      return undefined;
    }

    applyTheme(settings.theme);
    rememberThemeMode(settings.theme);
    void setLanguage(settings.language);
    return undefined;
  }, [settings]);

  return reduce ? "always" : "never";
}
