import { toast } from "sonner";
import { i18n } from "@/i18n";

/** Placeholder action for features that land in later tasks. Delete once nothing calls it. */
export function notifyComingSoon(): void {
  toast(i18n.t("shell.notYetAvailable"));
}
