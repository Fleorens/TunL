// The Settings tab — RDP: the FreeRDP 3 client, found automatically or chosen by hand (T31b). The client row is
// remounted with `key={clientPath}` so it re-reads the backend when the chosen program changes.

import { FileCode } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AppError } from "@/bindings/AppError";
import type { RdpClient } from "@/bindings/RdpClient";
import { Button } from "@/components/ui/button";
import { SettingGroup, SettingRow } from "@/features/settings/SettingRow";
import { saveSettings } from "@/features/settings/save-settings";
import { useSettings } from "@/features/settings/store";
import { notifyError } from "@/lib/errors";
import { pickFile } from "@/lib/files";
import { ipc } from "@/lib/ipc";

/** The auto-detected client: read on mount, remounted when the chosen program changes (`key`). */
function ClientRow() {
  const { t } = useTranslation();
  const [client, setClient] = useState<RdpClient | null>(null);
  const [error, setError] = useState<AppError | null>(null);

  useEffect(() => {
    let cancelled = false;
    ipc
      .rdpDetect()
      .then((next) => {
        if (!cancelled) setClient(next);
      })
      .catch((nextError) => {
        if (!cancelled) setError(nextError);
        // A forced path that is not FreeRDP 3 is expected: show « Not found », not a toast.
        if (nextError.kind !== "rdpClientMissing") notifyError(nextError);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const description = client
    ? t("settings.rdp.found", { path: client.path, version: client.version })
    : error?.kind === "rdpClientMissing"
      ? t("settings.rdp.missing")
      : undefined;

  return <SettingRow id="rdp-client" label={t("settings.rdp.client")} description={description} />;
}

export function RdpSection() {
  const { t } = useTranslation();
  const clientPath = useSettings((s) => s.settings?.rdp.clientPath);

  const choose = async () => {
    const path = await pickFile();
    if (path === null) return;
    void saveSettings((s) => ({ ...s, rdp: { ...s.rdp, clientPath: path } }));
  };

  const useFound = () => {
    void saveSettings((s) => ({ ...s, rdp: { ...s.rdp, clientPath: null } }));
  };

  return (
    <SettingGroup>
      <ClientRow key={clientPath ?? ""} />
      <SettingRow
        id="rdp-choose"
        label={t("settings.rdp.path")}
        description={clientPath ?? t("settings.rdp.pathAuto")}
      >
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" size="sm" onClick={useFound}>
            {t("settings.rdp.useFound")}
          </Button>
          <Button id="rdp-choose" variant="ghost" size="sm" onClick={choose}>
            <FileCode className="size-4" />
            {t("settings.rdp.choose")}
          </Button>
        </div>
      </SettingRow>
    </SettingGroup>
  );
}
