// Pick a file or a folder from the system file chooser (T26b, T31b). This is the ONLY file that imports the
// dialog plugin.
//
// In Tauri, `open` opens the system chooser and returns the chosen path (or `null` when the user cancels). In
// the mock and tests, `pickFile` and `pickFolder` return a preset path, so the gestures work without a real
// dialog (docs/04 §6).
import { isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

/** The files the mock "chooses" from the chooser: a report and a note, beside an existing name. */
export const MOCK_PICKED_FILES: readonly string[] = [
  "/home/user/Documents/report.pdf",
  "/home/user/Documents/notes.txt",
];

/** The folder the mock "drags" files from, when one is dropped on the list. */
export const MOCK_DROP_DIR = "/home/user/Desktop";

/** The program the mock "chooses" for the FreeRDP client (T31b). */
export const MOCK_PICKED_PROGRAM = "/opt/freerdp/bin/sdl-freerdp3";

/** The folder the mock "chooses" for the download directory (T31b). */
export const MOCK_PICKED_FOLDER = "/home/user/Transfers";

/** The file the mock "saves" the connections to (T32). */
export const MOCK_SAVE_PATH = "/home/user/tunl-connections.json";

/**
 * A file chosen in the system chooser, or `null` when the user cancels.
 *
 * In Tauri, `open` opens the chooser and `null` means the user cancelled. In the mock, `MOCK_PICKED_PROGRAM`.
 * `filters` narrows the chooser to a set of file types (e.g. JSON for an import).
 */
export async function pickFile(
  filters?: { name: string; extensions: string[] }[],
): Promise<string | null> {
  if (isTauri()) {
    const path = await open({ multiple: false, directory: false, filters });
    return path == null ? null : path;
  }
  return MOCK_PICKED_PROGRAM;
}

/**
 * A folder chosen in the system chooser, or `null` when the user cancels (T31b).
 *
 * In Tauri, `open` opens the chooser with `directory` and `null` means the user cancelled. In the mock,
 * `MOCK_PICKED_FOLDER`.
 */
export async function pickFolder(): Promise<string | null> {
  if (isTauri()) {
    const path = await open({ multiple: false, directory: true });
    return path == null ? null : path;
  }
  return MOCK_PICKED_FOLDER;
}

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

/**
 * The file the user "saves" to, or `null` when the user cancels (T32).
 *
 * In Tauri, `save` opens the chooser with a JSON filter and asks itself before replacing an existing file. In
 * the mock, `MOCK_SAVE_PATH`.
 */
export async function pickSaveFile(defaultName: string | null): Promise<string | null> {
  if (isTauri()) {
    const path = await save({
      defaultPath: defaultName ?? undefined,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    return path;
  }
  return MOCK_SAVE_PATH;
}
