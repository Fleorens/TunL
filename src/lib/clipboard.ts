import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "sonner";
import { i18n } from "@/i18n";
import { notifyError } from "@/lib/errors";
import { isMockBackend } from "@/lib/ipc";

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

/**
 * Read the clipboard, without a toast: copying inside a terminal is often silent. Tauri uses the
 * clipboard plugin; the browser uses `navigator.clipboard`. The only file that imports it.
 */
export async function readClipboardText(): Promise<string> {
  return isMockBackend ? navigator.clipboard.readText() : readText();
}

/**
 * Write text to the clipboard, without a toast. Tauri uses the clipboard plugin; the browser uses
 * `navigator.clipboard`.
 */
export async function writeClipboardText(text: string): Promise<void> {
  return isMockBackend ? navigator.clipboard.writeText(text) : writeText(text);
}
