import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
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

/**
 * Reveal a file or folder in its parent folder (the "Show in folder" button). Tauri uses the opener
 * plugin; the browser does nothing. The only place, together with `openExternal`, that touches the
 * opener plugin.
 */
export async function revealInFolder(path: string): Promise<void> {
  if (isMockBackend) {
    return;
  }
  await revealItemInDir(path);
}
