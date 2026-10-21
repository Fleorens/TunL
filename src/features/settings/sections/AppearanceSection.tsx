// The Settings tab — Appearance: theme, language, reduce animations, confirm before closing a tab.
import { useTranslation } from "react-i18next";
import { SettingGroup, SettingSelect, SettingSwitch } from "@/features/settings/SettingRow";
import { saveSettings } from "@/features/settings/save-settings";
import { useSettings } from "@/features/settings/store";

const THEMES = ["system", "dark", "light"] as const;
const LANGUAGES = ["system", "en", "fr"] as const;
const MOTIONS = ["system", "on", "off"] as const;

export function AppearanceSection() {
  const { t } = useTranslation();
  const theme = useSettings((s) => s.settings?.theme);
  const language = useSettings((s) => s.settings?.language);
  const reduceMotion = useSettings((s) => s.settings?.reduceMotion);
  const confirmClose = useSettings((s) => s.settings?.ui.confirmCloseActiveSession);

  const themeOptions = THEMES.map((value) => ({ value, label: t(`theme.${value}`) }));
  const languageOptions = LANGUAGES.map((value) => ({ value, label: t(`language.${value}`) }));
  const motionOptions = MOTIONS.map((value) => ({
    value,
    label: t(`settings.appearance.motion.${value}`),
  }));

  return (
    <SettingGroup>
      <SettingSelect
        label={t("settings.appearance.theme")}
        value={theme ?? "system"}
        options={themeOptions}
        onChange={(next) => saveSettings((s) => ({ ...s, theme: next }))}
      />
      <SettingSelect
        label={t("settings.appearance.language")}
        value={language ?? "system"}
        options={languageOptions}
        onChange={(next) => saveSettings((s) => ({ ...s, language: next }))}
      />
      <SettingSelect
        label={t("settings.appearance.reduceMotion")}
        description={t("settings.appearance.reduceMotionHelp")}
        value={reduceMotion ?? "system"}
        options={motionOptions}
        onChange={(next) => saveSettings((s) => ({ ...s, reduceMotion: next }))}
      />
      <SettingSwitch
        label={t("settings.appearance.confirmClose")}
        description={t("settings.appearance.confirmCloseHelp")}
        checked={confirmClose ?? false}
        onChange={(next) =>
          saveSettings((s) => ({ ...s, ui: { ...s.ui, confirmCloseActiveSession: next } }))
        }
      />
    </SettingGroup>
  );
}
