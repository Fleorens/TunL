// The Settings tab — SFTP: the local download folder (T31b). « Choose… » picks a folder; « Use the system folder »
// falls back to the system Downloads folder (`downloadDir: null`). The row label is associated to « Choose… » by
// `id` so the button is named « Download folder » (the « Choose… » text alone would clash with the RDP one).

import { FolderOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { SettingGroup, SettingRow } from "@/features/settings/SettingRow";
import { saveSettings } from "@/features/settings/save-settings";
import { useSettings } from "@/features/settings/store";
import { notifyError } from "@/lib/errors";
import { pickFolder } from "@/lib/files";

export function SftpSection() {
  const { t } = useTranslation();
  const downloadDir = useSettings((s) => s.settings?.ui.downloadDir);

  const choose = async () => {
    let path: string | null;
    try {
      path = await pickFolder();
    } catch (pickError) {
      notifyError(pickError);
      return;
    }
    if (path === null) return;
    void saveSettings((s) => ({ ...s, ui: { ...s.ui, downloadDir: path } }));
  };

  const useSystem = () => {
    void saveSettings((s) => ({ ...s, ui: { ...s.ui, downloadDir: null } }));
  };

  return (
    <SettingGroup>
      <SettingRow
        id="sftp-choose"
        label={t("settings.sftp.downloadDir")}
        description={downloadDir ?? t("settings.sftp.systemDownloads")}
      >
        <div className="flex shrink-0 items-center gap-2">
          {downloadDir && (
            <Button variant="ghost" size="sm" onClick={useSystem}>
              {t("settings.sftp.useSystem")}
            </Button>
          )}
          <Button id="sftp-choose" variant="ghost" size="sm" onClick={choose}>
            <FolderOpen className="size-4" />
            {t("settings.sftp.choose")}
          </Button>
        </div>
      </SettingRow>
    </SettingGroup>
  );
}
