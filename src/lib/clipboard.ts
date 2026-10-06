import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "sonner";
import { i18n } from "@/i18n";
import { notifyError } from "@/lib/errors";
import { isMockBackend } from "@/lib/ipc";

// In-memory clipboard for the mock backend. `writeClipboardText` stores the value here synchronously, so a
// following `readClipboardText` — and a terminal paste built on it — sees it in the same tick, before the
// next key (e.g. Enter) is processed. The real clipboard is updated too, for anything that reads it out-band.
let memory = "";

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
  if (isMockBackend) {
    // Resolve from the in-memory copy (already up to date) so a paste triggered right after a copy lands
    // in the same tick, before the next key.
    return memory;
  }
  return readText();
}

/**
 * Write text to the clipboard, without a toast. Tauri uses the clipboard plugin; the browser uses
 * `navigator.clipboard`.
 */
export async function writeClipboardText(text: string): Promise<void> {
  if (isMockBackend) {
    memory = text;
    await navigator.clipboard.writeText(text);
    return;
  }
  await writeText(text);
}
