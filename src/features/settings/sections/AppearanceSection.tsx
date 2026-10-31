// The Settings tab — Appearance: theme, language, reduce animations, confirm before closing a tab, reopen tabs.
import { useTranslation } from "react-i18next";
import type { RestoreTabs } from "@/bindings/RestoreTabs";
import { SettingGroup, SettingSelect, SettingSwitch } from "@/features/settings/SettingRow";
import { saveSettings } from "@/features/settings/save-settings";
import { useSettings } from "@/features/settings/store";
import { useUi } from "@/features/shell/ui-store";

const THEMES = ["system", "dark", "light"] as const;
const LANGUAGES = ["system", "en", "fr"] as const;
const MOTIONS = ["system", "on", "off"] as const;

export function AppearanceSection() {
  const { t } = useTranslation();
  const theme = useSettings((s) => s.settings?.theme);
  const language = useSettings((s) => s.settings?.language);
  const reduceMotion = useSettings((s) => s.settings?.reduceMotion);
  const confirmClose = useSettings((s) => s.settings?.ui.confirmCloseActiveSession);
  const titleBar = useSettings((s) => s.settings?.ui.titleBar);
  const restoreTabs = useSettings((s) => s.settings?.ui.restoreTabs);
  const forced = useUi((s) => s.windowChrome.forced);

  const themeOptions = THEMES.map((value) => ({ value, label: t(`theme.${value}`) }));
  const languageOptions = LANGUAGES.map((value) => ({ value, label: t(`language.${value}`) }));
  const motionOptions = MOTIONS.map((value) => ({
    value,
    label: t(`settings.appearance.motion.${value}`),
  }));
  const titleBarOptions = [
    { value: "native" as const, label: t("settings.appearance.titleBarOption.native") },
    { value: "custom" as const, label: t("settings.appearance.titleBarOption.custom") },
  ] as const;
  const restoreOptions: readonly { value: RestoreTabs; label: string }[] = [
    { value: "never", label: t("settings.appearance.restoreTabsOption.never") },
    { value: "ask", label: t("settings.appearance.restoreTabsOption.ask") },
    { value: "always", label: t("settings.appearance.restoreTabsOption.always") },
  ];

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
      <SettingSelect
        id="settings-title-bar"
        label={t("settings.appearance.titleBar")}
        value={titleBar ?? "native"}
        options={titleBarOptions}
        onChange={(next) => saveSettings((s) => ({ ...s, ui: { ...s.ui, titleBar: next } }))}
        description={
          forced && titleBar === "custom"
            ? t("settings.appearance.titleBarForced")
            : t("settings.appearance.titleBarHelp")
        }
      />
      <SettingSwitch
        label={t("settings.appearance.confirmClose")}
        description={t("settings.appearance.confirmCloseHelp")}
        checked={confirmClose ?? false}
        onChange={(next) =>
          saveSettings((s) => ({ ...s, ui: { ...s.ui, confirmCloseActiveSession: next } }))
        }
      />
      <SettingSelect
        id="settings-restore-tabs"
        label={t("settings.appearance.restoreTabs")}
        value={restoreTabs ?? "ask"}
        options={restoreOptions}
        onChange={(next) => saveSettings((s) => ({ ...s, ui: { ...s.ui, restoreTabs: next } }))}
      />
    </SettingGroup>
  );
}
