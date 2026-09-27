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

type ConfirmKind = "connection" | "group";

interface ConfirmDeleteProps {
  open: boolean;
  kind: ConfirmKind;
  name: string;
  /** Close the dialog without doing anything. */
  onClose: () => void;
  /** Perform the destructive action (delete). */
  onConfirm: () => void;
}

/**
 * Single dialog for both destructive actions: deleting a connection, or deleting a
 * group (whose connections then move to Ungrouped). Rendered outside the menu, opened
 * from the Sidebar so the Radix menu/dialog focus conflict is handled there.
 *
 * `onClose` only closes the dialog; `onConfirm` performs the delete. This split matters
 * because Radix's `AlertDialogAction` closes the dialog on its own, so `onOpenChange`
 * fires right after the click — conflating the two would run the delete twice.
 */
export function ConfirmDelete({ open, kind, name, onClose, onConfirm }: ConfirmDeleteProps) {
  const { t } = useTranslation();

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {kind === "group"
              ? t("confirm.deleteGroup", { name })
              : t("confirm.deleteConnection", { name })}
          </AlertDialogTitle>
          {kind === "group" && (
            <AlertDialogDescription>{t("confirm.deleteGroupDescription")}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{t("common.delete")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
