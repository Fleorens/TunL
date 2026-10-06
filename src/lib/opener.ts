import { openUrl } from "@tauri-apps/plugin-opener";
import { isOpenableUrl } from "@/features/terminal/terminal-keys";
import { isMockBackend } from "@/lib/ipc";

/**
 * Open a URL in the user's default application. Refuses what `isOpenableUrl` refuses (S10): only
 * `http:` and `https:`, and only when the string parses. Tauri uses the opener plugin; the browser
 * uses `window.open`. The only file that imports the opener plugin.
 */
export async function openExternal(url: string): Promise<void> {
  if (!isOpenableUrl(url)) {
    return;
  }
  if (isMockBackend) {
    void window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  await openUrl(url);
}
