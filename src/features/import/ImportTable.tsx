// The body of the import dialog: loading rows, the candidate table, and the empty / error states.
// Every component is declared at module level: one declared inside another is a new type on each
// render, so React remounts it and a checkbox loses the keyboard focus on every toggle (lot 3 review).

import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AppError } from "@/bindings/AppError";
import type { ImportCandidate } from "@/bindings/ImportCandidate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { candidateAddress, isSelectable, jumpLabel, toggleAlias, toggleAll } from "./selection";

const EMPTY_CELL = "—";

export type ImportPhase = "loading" | "ready" | "notFound" | "error";

interface ImportBodyProps {
  phase: ImportPhase;
  candidates: ImportCandidate[] | null;
  error: AppError | null;
  selection: string[];
  onSelectionChange: (selection: string[]) => void;
  onRetry: () => void;
}

export function ImportBody({
  phase,
  candidates,
  error,
  selection,
  onSelectionChange,
  onRetry,
}: ImportBodyProps) {
  if (phase === "loading") return <LoadingRows />;
  if (phase === "notFound") return <NotFound />;
  if (phase === "error") return <GenericError error={error} onRetry={onRetry} />;
  if (!candidates) return null;
  if (candidates.length === 0) return <NothingToImport />;
  return (
    <CandidateTable
      candidates={candidates}
      selection={selection}
      onSelectionChange={onSelectionChange}
    />
  );
}

function CandidateTable({
  candidates,
  selection,
  onSelectionChange,
}: {
  candidates: ImportCandidate[];
  selection: string[];
  onSelectionChange: (selection: string[]) => void;
}) {
  const { t } = useTranslation();
  const selectableCount = candidates.filter(isSelectable).length;
  const allSelected = selectableCount > 0 && selection.length === selectableCount;
  const headerState: boolean | "indeterminate" =
    allSelected || selection.length === 0 ? allSelected : "indeterminate";

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">
            <Checkbox
              aria-label={t("import.selectAll")}
              checked={headerState}
              onCheckedChange={() => onSelectionChange(toggleAll(candidates, selection))}
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
        {candidates.map((candidate) => {
          const selectable = isSelectable(candidate);
          return (
            <TableRow
              key={candidate.alias}
              aria-disabled={selectable ? undefined : true}
              className="aria-disabled:text-muted-foreground"
            >
              <TableCell>
                <Checkbox
                  aria-label={t("import.select", { alias: candidate.alias })}
                  checked={selection.includes(candidate.alias)}
                  disabled={!selectable}
                  onCheckedChange={() => onSelectionChange(toggleAlias(selection, candidate.alias))}
                />
              </TableCell>
              <TableCell className="font-medium">{candidate.alias}</TableCell>
              <TableCell className="font-mono">{candidateAddress(candidate)}</TableCell>
              <TableCell>{candidate.keyPath ?? EMPTY_CELL}</TableCell>
              <TableCell>
                <JumpCell candidate={candidate} />
              </TableCell>
              <TableCell>
                <NotesCell candidate={candidate} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function JumpCell({ candidate }: { candidate: ImportCandidate }) {
  if (candidate.jump == null) return EMPTY_CELL;
  if (candidate.jump.type === "unresolved") {
    return (
      <span className="flex items-center gap-1 text-warning">
        <TriangleAlert className="size-3" />
        {candidate.jump.hop}
      </span>
    );
  }
  return jumpLabel(candidate.jump) ?? EMPTY_CELL;
}

function NotesCell({ candidate }: { candidate: ImportCandidate }) {
  const { t } = useTranslation();
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

function LoadingRows() {
  return (
    <div className="flex flex-col gap-2 py-2">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

function NothingToImport() {
  const { t } = useTranslation();
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{t("import.empty")}</EmptyTitle>
      </EmptyHeader>
    </Empty>
  );
}

function NotFound() {
  const { t } = useTranslation();
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{t("import.notFoundTitle")}</EmptyTitle>
        <EmptyDescription>{t("import.notFoundDescription")}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function GenericError({ error, onRetry }: { error: AppError | null; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{error ? t(`errors.kind.${error.kind}`) : ""}</EmptyTitle>
        {error && <EmptyDescription>{error.message}</EmptyDescription>}
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={onRetry}>{t("import.retry")}</Button>
      </EmptyContent>
    </Empty>
  );
}
