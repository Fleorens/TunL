// The Settings tab — Backup: export the connections to a JSON file, import one back. No secret goes with an
// export; a re-import asks for passwords again, or reads the local keyring.

import { Download, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { exportConnections, importConnections } from "@/features/connections/exchange";
import { SettingGroup, SettingRow } from "@/features/settings/SettingRow";
import { notifyError } from "@/lib/errors";

/** One row: the action's label and its help on the left, the button on the right. */
function ActionRow({
  label,
  description,
  buttonLabel,
  icon: Icon,
  onRun,
}: {
  label: string;
  description: string;
  buttonLabel: string;
  icon: typeof Download;
  onRun: () => Promise<void>;
}) {
  return (
    <SettingRow label={label} description={description}>
      <Button
        variant="outline"
        size="sm"
        aria-label={label}
        onClick={() => void onRun().catch(notifyError)}
      >
        <Icon />
        {buttonLabel}
      </Button>
    </SettingRow>
  );
}

export function BackupSection() {
  const { t } = useTranslation();
  return (
    <SettingGroup>
      <ActionRow
        label={t("settings.backup.export")}
        description={t("settings.backup.exportHelp")}
        buttonLabel={t("settings.backup.exportButton")}
        icon={Download}
        onRun={exportConnections}
      />
      <ActionRow
        label={t("settings.backup.import")}
        description={t("settings.backup.importHelp")}
        buttonLabel={t("settings.backup.importButton")}
        icon={Upload}
        onRun={importConnections}
      />
    </SettingGroup>
  );
}
