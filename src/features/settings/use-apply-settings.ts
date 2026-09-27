import { useEffect } from "react";
import type { ReduceMotion } from "@/bindings/ReduceMotion";
import { useSettings } from "@/features/settings/store";
import { setLanguage } from "@/i18n";
import { applyTheme, readStoredThemeMode, rememberThemeMode } from "@/lib/theme";

/** The values `<MotionConfig reducedMotion>` accepts. */
export type AppliedMotion = "user" | "always" | "never";

/** Maps the stored `reduceMotion` to the value `<MotionConfig>` expects. */
function reduceMotionToMotion(reduceMotion?: ReduceMotion): AppliedMotion {
  switch (reduceMotion) {
    case "on":
      return "always";
    case "off":
      return "never";
    default:
      return "user";
  }
}

/**
 * Applies theme, language and animation settings as they load and change.
 *
 * - Theme: until settings load, use the remembered mode (no startup flash); then apply and remember.
 * - Language: switch to `settings.language`.
 * - Animations: the returned value feeds `<MotionConfig>`.
 */
export function useApplySettings(): AppliedMotion {
  const settings = useSettings((state) => state.settings);

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

  return reduceMotionToMotion(settings?.reduceMotion);
}
