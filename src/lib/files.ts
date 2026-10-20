// Pick files from the system file chooser (T26b). This is the ONLY file that imports the dialog plugin.
//
// In Tauri, `open` opens the system chooser and returns the chosen paths. In the mock and tests, it returns a
// copy of the preset list, so the upload gesture works without a real dialog (docs/04 §6).
import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

/** The files the mock "chooses" from the chooser: a report and a note, beside an existing name. */
export const MOCK_PICKED_FILES: readonly string[] = [
  "/home/user/Documents/report.pdf",
  "/home/user/Documents/notes.txt",
];

/** The folder the mock "drags" files from, when one is dropped on the list. */
export const MOCK_DROP_DIR = "/home/user/Desktop";

/**
 * The files chosen in the system chooser (several), or none when the user cancels.
 *
 * In Tauri, `open` opens the chooser and `null` means the user cancelled. In the mock, a copy of `MOCK_PICKED_FILES`.
 */
export async function pickFiles(): Promise<string[]> {
  if (isTauri()) {
    const paths = await open({ multiple: true, directory: false });
    return paths == null ? [] : [...paths];
  }
  return [...MOCK_PICKED_FILES];
}
