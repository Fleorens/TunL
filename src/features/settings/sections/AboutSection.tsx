// The Settings tab — About: the version, the licence, the source-code link, and the configuration and log
// folders (each with a « Show » button that reveals it in the file manager).
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AppInfo } from "@/bindings/AppInfo";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SettingGroup } from "@/features/settings/SettingRow";
import { notifyError } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import { openExternal, revealInFolder } from "@/lib/opener";

/** The repository the « Source code » button opens. */
export const REPOSITORY_URL = "https://github.com/Fleorens/TunL";

/** One folder row: the folder name as a label, its path as help, and a « Show » button linked by `id`. */
function FolderRow({ name, path, showLabel }: { name: string; path: string; showLabel: string }) {
  const id = `folder-${path}`;
  return (
    <div className="flex items-center gap-3">
      <Label htmlFor={id} className="truncate text-sm font-medium">
        {name}
      </Label>
      <span className="truncate text-xs text-muted-foreground">{path}</span>
      <Button
        id={id}
        variant="ghost"
        size="sm"
        onClick={() => void revealInFolder(path).catch(notifyError)}
      >
        {showLabel}
      </Button>
    </div>
  );
}

export function AboutSection() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    ipc.appInfo().then(setInfo).catch(notifyError);
  }, []);

  return (
    <SettingGroup>
      <div className="flex items-center gap-4 py-3">
        <Logo size={40} />
        <div className="flex flex-col gap-0.5">
          {/* `info.name` is the package name `tunl` (D14); the brand is shown as a literal. */}
          <span className="text-sm font-medium">TunL</span>
          <span className="font-mono text-xs text-muted-foreground">
            {t("settings.about.version", { version: info?.version ?? "…" })}
          </span>
        </div>
      </div>
      <p className="py-3 text-xs text-muted-foreground">{t("settings.about.licence")}</p>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void openExternal(REPOSITORY_URL).catch(notifyError)}
      >
        {t("settings.about.repository")}
      </Button>
      {info && (
        <>
          <FolderRow
            name={t("settings.about.configDir")}
            path={info.configDir}
            showLabel={t("settings.about.showFolder")}
          />
          <FolderRow
            name={t("settings.about.logDir")}
            path={info.logDir}
            showLabel={t("settings.about.showFolder")}
          />
        </>
      )}
    </SettingGroup>
  );
}
