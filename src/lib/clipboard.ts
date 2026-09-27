import { toast } from "sonner";
import { i18n } from "@/i18n";
import { notifyError } from "@/lib/errors";

/**
 * Copy text to the clipboard. Success shows a translated toast; failure shows an error toast.
 * The only file that changes when we move to a Tauri clipboard plugin.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(i18n.t("clipboard.copied"));
    return true;
  } catch (error) {
    notifyError(error);
    return false;
  }
}
