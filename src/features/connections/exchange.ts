// The backup gestures of the Settings tab (T32): export the connections to a JSON file, import one back.
// No secret goes with an export; a re-import asks for passwords again, or reads the local keyring.
import { toast } from "sonner";
import type { ImportReport } from "@/bindings/ImportReport";
import { useConnections } from "@/features/connections/store";
import { i18n } from "@/i18n";
import { notifyError } from "@/lib/errors";
import { pickFile, pickSaveFile } from "@/lib/files";
import { ipc } from "@/lib/ipc";

/** The name the save chooser proposes for the export. */
export const EXPORT_FILE_NAME = "tunl-connections.json";

/**
 * The toast text of an import: the number added (always), then the number skipped and refused, only when
 * they are not zero, joined by a middle dot.
 */
export function importSummary(report: ImportReport): string {
  const parts: string[] = [i18n.t("exchange.added", { count: report.added })];
  if (report.skipped !== 0) parts.push(i18n.t("exchange.skipped", { count: report.skipped }));
  if (report.invalid !== 0) parts.push(i18n.t("exchange.invalid", { count: report.invalid }));
  return parts.join(" · ");
}

/** Save the connections to a JSON file; nothing when the user cancels. */
export async function exportConnections(): Promise<void> {
  let path: string | null;
  try {
    path = await pickSaveFile(EXPORT_FILE_NAME);
  } catch (error) {
    notifyError(error);
    return;
  }
  if (path == null) return;
  try {
    const count = await ipc.storeExport(path);
    toast.success(i18n.t("exchange.exported", { count }), { description: path });
  } catch (error) {
    notifyError(error);
  }
}

/** Import the connections from a JSON file; nothing when the user cancels. */
export async function importConnections(): Promise<void> {
  let path: string | null;
  try {
    path = await pickFile();
  } catch (error) {
    notifyError(error);
    return;
  }
  if (path == null) return;
  try {
    const report = await ipc.storeImport(path);
    useConnections.getState().load();
    toast.success(i18n.t("exchange.imported"), { description: importSummary(report) });
  } catch (error) {
    notifyError(error);
  }
}
