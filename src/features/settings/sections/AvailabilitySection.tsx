// The Settings tab — Availability: enable the probes, then the interval (shown only while they are on).
import { useTranslation } from "react-i18next";
import { SettingGroup, SettingSelect, SettingSwitch } from "@/features/settings/SettingRow";
import { saveSettings } from "@/features/settings/save-settings";
import { intervalParts, PROBE_INTERVALS } from "@/features/settings/settings-options";
import { useSettings } from "@/features/settings/store";

export function AvailabilitySection() {
  const { t } = useTranslation();
  const enabled = useSettings((s) => s.settings?.reachability.enabled);
  const interval = useSettings((s) => s.settings?.reachability.intervalSecs);

  const intervalOptions = PROBE_INTERVALS.map((seconds) => {
    const { count, unit } = intervalParts(seconds);
    return { value: String(seconds), label: t(`settings.availability.every.${unit}`, { count }) };
  });

  return (
    <SettingGroup>
      <SettingSwitch
        label={t("settings.availability.enabled")}
        description={t("settings.availability.enabledHelp")}
        checked={enabled ?? false}
        onChange={(next) =>
          saveSettings((s) => ({ ...s, reachability: { ...s.reachability, enabled: next } }))
        }
      />
      {enabled && (
        <SettingSelect
          label={t("settings.availability.interval")}
          value={String(interval ?? 60)}
          options={intervalOptions}
          onChange={(next) =>
            saveSettings((s) => ({
              ...s,
              reachability: { ...s.reachability, intervalSecs: Number(next) },
            }))
          }
        />
      )}
    </SettingGroup>
  );
}
