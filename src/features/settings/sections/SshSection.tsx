// The Settings tab — SSH: the connection defaults (timeout, keepalive) and the known hosts TunL trusts (T31b).
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { SettingGroup, SettingSelect } from "@/features/settings/SettingRow";
import { saveSettings } from "@/features/settings/save-settings";
import { KnownHostsList } from "@/features/settings/sections/KnownHostsList";
import { CONNECT_TIMEOUTS, KEEPALIVES, withCurrent } from "@/features/settings/settings-options";
import { useSettings } from "@/features/settings/store";

/** The keepalive options: 0 is « Off », the rest are seconds. */
function keepaliveOptions(t: TFunction, current: number) {
  return withCurrent(KEEPALIVES, current).map((value) => ({
    value: String(value),
    label: value === 0 ? t("settings.ssh.off") : t("settings.ssh.seconds", { count: value }),
  }));
}

/** The SSH connection defaults, saved one at a time. */
export function SshSection() {
  const { t } = useTranslation();
  const ssh = useSettings((s) => s.settings?.ssh);
  const connectTimeout = ssh?.connectTimeoutSecs ?? 15;
  const keepalive = ssh?.keepaliveSecs ?? 30;

  const connectTimeoutOptions = withCurrent(CONNECT_TIMEOUTS, connectTimeout).map((value) => ({
    value: String(value),
    label: t("settings.ssh.seconds", { count: value }),
  }));

  return (
    <div className="flex flex-col gap-6">
      <SettingGroup title={t("settings.ssh.defaults")} description={t("settings.ssh.defaultsHelp")}>
        <SettingSelect
          label={t("settings.ssh.connectTimeout")}
          value={String(connectTimeout)}
          options={connectTimeoutOptions}
          onChange={(next) =>
            saveSettings((s) => ({
              ...s,
              ssh: { ...s.ssh, connectTimeoutSecs: Number(next) },
            }))
          }
        />
        <SettingSelect
          label={t("settings.ssh.keepalive")}
          description={t("settings.ssh.keepaliveHelp")}
          value={String(keepalive)}
          options={keepaliveOptions(t, keepalive)}
          onChange={(next) =>
            saveSettings((s) => ({
              ...s,
              ssh: { ...s.ssh, keepaliveSecs: Number(next) },
            }))
          }
        />
      </SettingGroup>
      <SettingGroup>
        <KnownHostsList />
      </SettingGroup>
    </div>
  );
}
