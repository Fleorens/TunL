// The close confirmation: shown while tabs are waiting for it (`closing` set), cancelled or confirmed from here.
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
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
  const sessions = useSessions(
    useShallow((state) =>
      closing ? state.sessions.filter((session) => closing.includes(session.id)) : [],
    ),
  );
  if (closing === null || closing.length === 0 || sessions.length === 0) return null;

  return (
    <AlertDialog open onOpenChange={() => useSessions.getState().cancelClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {sessions.length === 1
              ? t("sessions.confirmClose.title", { name: sessions[0].title })
              : t("sessions.confirmClose.titleMany", { count: sessions.length })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {sessions.length === 1
              ? t("sessions.confirmClose.description")
              : t("sessions.confirmClose.descriptionMany")}
          </AlertDialogDescription>
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
