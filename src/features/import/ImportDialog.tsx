import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { AppError } from "@/bindings/AppError";
import type { ImportPreview } from "@/bindings/ImportPreview";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConnections } from "@/features/connections/store";
import { useUi } from "@/features/shell/ui-store";
import { i18n } from "@/i18n";
import { notifyError, toAppError } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import { ImportBody, type ImportPhase } from "./ImportTable";
import { importNoteText } from "./import-notes";
import { initialSelection } from "./selection";

const NONE = "__none__";

export function ImportDialog() {
  const { t } = useTranslation();
  const importOpen = useUi((state) => state.importOpen);
  const closeImport = useUi((state) => state.closeImport);
  const groups = useConnections((state) => state.groups);

  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [phase, setPhase] = useState<ImportPhase>("loading");
  const [error, setError] = useState<AppError | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [groupId, setGroupId] = useState<string>(NONE);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setPhase("loading");
    setPreview(null);
    setError(null);
    setSelection([]);
    setGroupId(NONE);
    try {
      const result = await ipc.importSshConfigPreview(null);
      setPreview(result);
      setSelection(initialSelection(result.candidates));
      setPhase("ready");
    } catch (err) {
      const appError = toAppError(err);
      setError(appError);
      setPhase(appError.kind === "notFound" ? "notFound" : "error");
    }
  }, []);

  // (Re)load every time the dialog opens: fresh preview, default selection, « No group ».
  useEffect(() => {
    if (!importOpen) return;
    void load();
  }, [importOpen, load]);

  async function applyImport() {
    setSending(true);
    try {
      const before = useConnections.getState().connections.length;
      const snapshot = await ipc.importSshConfigApply(
        null,
        selection,
        groupId === NONE ? null : groupId,
      );
      useConnections.getState().replaceSnapshot(snapshot);
      const created = snapshot.connections.length - before;
      toast.success(i18n.t("import.done", { count: created }));
      closeImport();
    } catch (err) {
      notifyError(err);
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={importOpen} onOpenChange={closeImport}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{t("import.title")}</DialogTitle>
          {preview && <DialogDescription>{preview.path}</DialogDescription>}
          {preview && preview.warnings.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {preview.warnings.map(importNoteText).join("; ")}
            </p>
          )}
        </DialogHeader>

        <div className="max-h-[60vh] flex-1 overflow-y-auto">
          <ImportBody
            phase={phase}
            candidates={preview?.candidates ?? null}
            error={error}
            selection={selection}
            onSelectionChange={setSelection}
            onRetry={load}
          />
        </div>

        <DialogFooter className="mt-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{t("import.into")}</span>
            <Select value={groupId} onValueChange={setGroupId}>
              <SelectTrigger className="min-w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("import.noGroup")}</SelectItem>
                {groups.map((group) => (
                  <SelectItem key={group.id} value={group.id}>
                    {group.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={closeImport}>
              {t("common.cancel")}
            </Button>
            <Button onClick={applyImport} disabled={selection.length === 0 || sending}>
              {t("import.submit", { count: selection.length })}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
