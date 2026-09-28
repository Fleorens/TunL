import { TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { AppError } from "@/bindings/AppError";
import type { ImportCandidate } from "@/bindings/ImportCandidate";
import type { ImportPreview } from "@/bindings/ImportPreview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useConnections } from "@/features/connections/store";
import { useUi } from "@/features/shell/ui-store";
import { i18n } from "@/i18n";
import { notifyError, toAppError } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import {
  candidateAddress,
  initialSelection,
  isSelectable,
  jumpLabel,
  toggleAlias,
  toggleAll,
} from "./selection";

const NONE = "__none__";
const UNGROUPED = "—";

type Phase = "loading" | "ready" | "notFound" | "error";

export function ImportDialog() {
  const { t } = useTranslation();
  const importOpen = useUi((state) => state.importOpen);
  const closeImport = useUi((state) => state.closeImport);
  const groups = useConnections((state) => state.groups);

  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
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

  const selectableCount = preview?.candidates.filter(isSelectable).length ?? 0;
  const allSelected = selectableCount > 0 && selection.length === selectableCount;

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
        </DialogHeader>

        <div className="max-h-[60vh] flex-1 overflow-y-auto">
          {phase === "loading" ? <LoadingRows /> : <CandidateList />}
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

  function LoadingRows() {
    return (
      <div className="flex flex-col gap-2 py-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  function CandidateList() {
    if (preview?.candidates.length === 0) {
      return <NothingToImport />;
    }
    if (phase === "notFound") {
      return <NotFound />;
    }
    if (phase === "error") {
      return <GenericError error={error} onRetry={load} />;
    }
    if (!preview) return null;

    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <SelectAll
                checked={allSelected}
                onCheckedChange={() => setSelection(toggleAll(preview.candidates, selection))}
              />
            </TableHead>
            <TableHead>{t("import.columns.host")}</TableHead>
            <TableHead>{t("import.columns.address")}</TableHead>
            <TableHead>{t("import.columns.key")}</TableHead>
            <TableHead>{t("import.columns.jump")}</TableHead>
            <TableHead>{t("import.columns.notes")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {preview.candidates.map((candidate) => (
            <TableRow key={candidate.alias}>
              <TableCell>
                <RowSelect
                  ariaLabel={t("import.select", { alias: candidate.alias })}
                  checked={selection.includes(candidate.alias)}
                  disabled={!isSelectable(candidate)}
                  onCheckedChange={() => setSelection(toggleAlias(selection, candidate.alias))}
                />
              </TableCell>
              <TableCell className="font-medium">{candidate.alias}</TableCell>
              <TableCell className="font-mono">{candidateAddress(candidate)}</TableCell>
              <TableCell>{candidate.keyPath ?? UNGROUPED}</TableCell>
              <TableCell>{JumpCell(candidate)}</TableCell>
              <TableCell>{NotesCell(candidate)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  function RowSelect(props: {
    ariaLabel: string;
    checked: boolean;
    disabled?: boolean;
    onCheckedChange: () => void;
  }) {
    return (
      <Checkbox
        aria-label={props.ariaLabel}
        checked={props.checked}
        disabled={props.disabled}
        onCheckedChange={props.onCheckedChange}
      />
    );
  }

  function SelectAll(props: { checked: boolean; onCheckedChange: () => void }) {
    const checked: boolean | "indeterminate" =
      selection.length > 0 && !props.checked ? "indeterminate" : props.checked;
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Checkbox
            aria-label={t("import.selectAll")}
            checked={checked}
            onCheckedChange={props.onCheckedChange}
          />
        </TooltipTrigger>
        <TooltipContent>{t("import.selectAll")}</TooltipContent>
      </Tooltip>
    );
  }

  function JumpCell(candidate: ImportCandidate) {
    const label = jumpLabel(candidate.jump);
    if (candidate.jump == null) return UNGROUPED;
    if (candidate.jump.type === "unresolved") {
      return (
        <span className="flex items-center gap-1 text-warning">
          <TriangleAlert className="size-3" />
          {candidate.jump.hop}
        </span>
      );
    }
    return label ?? UNGROUPED;
  }

  function NotesCell(candidate: ImportCandidate) {
    return (
      <div className="flex flex-col gap-0.5">
        {candidate.duplicateOf != null && (
          <Badge variant="outline">{t("import.alreadyPresent")}</Badge>
        )}
        {candidate.warnings.map((warning) => (
          <span key={warning} className="text-xs text-muted-foreground">
            {warning}
          </span>
        ))}
        {candidate.error != null && (
          <span className="text-xs text-destructive">{candidate.error}</span>
        )}
      </div>
    );
  }

  function NothingToImport() {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t("import.empty")}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  function NotFound() {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t("import.notFoundTitle")}</EmptyTitle>
          <EmptyDescription>{t("import.notFoundDescription")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  function GenericError({
    error: appError,
    onRetry,
  }: {
    error: AppError | null;
    onRetry: () => void;
  }) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{appError ? t(`errors.kind.${appError.kind}`) : ""}</EmptyTitle>
          {appError && <EmptyDescription>{appError.message}</EmptyDescription>}
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={onRetry}>{t("import.retry")}</Button>
        </EmptyContent>
      </Empty>
    );
  }
}
