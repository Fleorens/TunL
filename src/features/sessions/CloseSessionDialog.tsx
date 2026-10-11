// The close confirmation: shown while a tab is waiting for it (`closing` set), cancelled or confirmed from here.
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
import { useSessions } from "./store";

/** The AlertDialog bound to the store's `closing`: it only mounts while a close is pending. */
export function CloseSessionDialog() {
  const { t } = useTranslation();
  const closing = useSessions((state) => state.closing);
  const session = useSessions((state) =>
    closing ? state.sessions.find((s) => s.id === closing) : undefined,
  );
  if (closing === null || !session) return null;

  return (
    <AlertDialog open={closing !== null} onOpenChange={() => useSessions.getState().cancelClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("sessions.confirmClose.title", { name: session.title })}
          </AlertDialogTitle>
          <AlertDialogDescription>{t("sessions.confirmClose.description")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={() => useSessions.getState().confirmClose()}>
            {t("sessions.confirmClose.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
