// The Settings tab — SSH: the known hosts TunL trusts (T31b). It lists them, each with a « Forget » that removes
// its key after a confirmation. The list is read from the backend on mount and refreshed after a removal.

import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { KnownHostEntry } from "@/bindings/KnownHostEntry";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SettingGroup } from "@/features/settings/SettingRow";
import { hostLabel } from "@/features/settings/settings-options";
import { notifyError } from "@/lib/errors";
import { ipc } from "@/lib/ipc";

/** The key removed and the list refreshed after « Forget ». */
function useKnownHosts() {
  const [entries, setEntries] = useState<KnownHostEntry[] | null>(null);

  const reload = useCallback(() => {
    void ipc.knownHostsList().then(setEntries).catch(notifyError);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const forget = useCallback(
    (entry: KnownHostEntry) => {
      void ipc.knownHostRemove(entry.host, entry.port).then(reload).catch(notifyError);
    },
    [reload],
  );

  return { entries, forget };
}

/** The « Forget » confirmation for one host, opened from its row. */
function ForgetDialog({
  host,
  open,
  onOpenChange,
  onForget,
}: {
  host: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onForget: () => void;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("settings.ssh.forgetTitle", { host })}</AlertDialogTitle>
          <AlertDialogDescription>{t("settings.ssh.forgetDescription")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onForget}>
            {t("settings.ssh.forgetConfirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** One known host: its name and key, and a « Forget » button that opens the confirmation. */
function KnownHostRow({ entry, onForget }: { entry: KnownHostEntry; onForget: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const forgetLabel = t("settings.ssh.forget", { host: entry.host });
  return (
    <li aria-label={hostLabel(entry.host, entry.port)} className="flex items-center gap-3 py-2">
      <div className="grid min-w-0 flex-1">
        <span className="truncate font-mono text-sm">{entry.host}</span>
        <span
          className="truncate font-mono text-xs text-muted-foreground"
          title={entry.fingerprint}
        >
          {entry.keyType} · {entry.fingerprint}
        </span>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={forgetLabel}
            onClick={() => setOpen(true)}
          >
            <Trash2 className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{forgetLabel}</TooltipContent>
      </Tooltip>
      <ForgetDialog
        host={entry.host}
        open={open}
        onOpenChange={setOpen}
        onForget={() => {
          onForget();
          setOpen(false);
        }}
      />
    </li>
  );
}

/** The known hosts card of the SSH section: the title, the help, and the list (or the empty state). */
export function KnownHostsList() {
  const { t } = useTranslation();
  const { entries, forget } = useKnownHosts();
  return (
    <SettingGroup
      title={t("settings.ssh.knownHosts")}
      description={t("settings.ssh.knownHostsHelp")}
    >
      {entries === null ? null : entries.length === 0 ? (
        <p className="py-3 text-xs text-muted-foreground">{t("settings.ssh.noKnownHosts")}</p>
      ) : (
        <ul aria-label={t("settings.ssh.knownHosts")}>
          {entries.map((entry) => (
            <KnownHostRow
              key={`${entry.host}:${entry.port}:${entry.keyType}:${entry.fingerprint}`}
              entry={entry}
              onForget={() => forget(entry)}
            />
          ))}
        </ul>
      )}
    </SettingGroup>
  );
}
