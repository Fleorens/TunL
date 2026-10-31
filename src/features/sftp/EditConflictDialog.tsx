// The conflict when a file changed on the server since it opened: keep the local save (send nothing) or
// replace the server's version with it (destructive). Cancel or Escape closes the dialog, which is a keep.
import { useTranslation } from "react-i18next";
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

interface EditConflictDialogProps {
  /** The edited file, for the title. */
  name: string;
  /** Send nothing back: keep the local save. */
  onKeep: () => void;
  /** Replace the server's version with the local save. */
  onReplace: () => void;
}

export function EditConflictDialog({ name, onKeep, onReplace }: EditConflictDialogProps) {
  const { t } = useTranslation();
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onKeep();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("sftp.edit.conflictTitle", { name })}</AlertDialogTitle>
          <AlertDialogDescription>{t("sftp.edit.conflict")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("sftp.edit.keep")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onReplace}>
            {t("sftp.edit.replace")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
