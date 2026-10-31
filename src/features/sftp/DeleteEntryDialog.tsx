// The delete confirmation: a folder says how many entries go with it, counted by the server beforehand (S11).
// One entry keeps the T25b dialog; several show a single confirmation with the total counted first.
import { useTranslation } from "react-i18next";
import type { RemoteEntry } from "@/bindings/RemoteEntry";
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

interface DeleteEntryDialogProps {
  entries: readonly RemoteEntry[];
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteEntryDialog({ entries, count, onConfirm, onCancel }: DeleteEntryDialogProps) {
  const { t } = useTranslation();
  if (entries.length === 0) return null;
  const entry = entries[0];
  const many = entries.length > 1;
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {many
              ? t("sftp.delete.titleMany", { count: entries.length })
              : t("sftp.delete.title", { name: entry.name })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {many
              ? t("sftp.delete.many", { count })
              : entry.kind === "dir"
                ? t("sftp.delete.folder", { count })
                : t("sftp.delete.file")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            {t("sftp.delete.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
