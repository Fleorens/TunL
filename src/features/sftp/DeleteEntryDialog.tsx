// The delete confirmation: a folder says how many entries go with it, counted by the server beforehand (S11).
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
  entry: RemoteEntry;
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteEntryDialog({ entry, count, onConfirm, onCancel }: DeleteEntryDialogProps) {
  const { t } = useTranslation();
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("sftp.delete.title", { name: entry.name })}</AlertDialogTitle>
          <AlertDialogDescription>
            {entry.kind === "dir" ? t("sftp.delete.folder", { count }) : t("sftp.delete.file")}
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
