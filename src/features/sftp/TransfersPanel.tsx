// The transfers panel, folded under the SFTP explorer (docs/04 §6): one collapsible, open by default, with a
// header ("Transfers (n)" that folds it, "Clear finished" when something is done) and one line per transfer.
// Pure view of the store: it reads the transfers of its session, starts and cancels them, and never builds the
// event channel (that is the mock/Tauri side, T26).
import type { TFunction } from "i18next";
import { ChevronDown, ChevronUp, FolderOpen, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AppError } from "@/bindings/AppError";
import { IconButton } from "@/components/IconButton";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { describeError, notifyError } from "@/lib/errors";
import { revealInFolder } from "@/lib/opener";
import { cn } from "@/lib/utils";
import { formatSize } from "./sftp-model";
import { percentOf, type Transfer } from "./transfer-model";
import { useTransfers } from "./transfers-store";

interface TransfersPanelProps {
  sessionId: string;
}

/** The final state of a transfer, in words: done, cancelled, or the title of its error. */
function statusText(transfer: Transfer, t: TFunction): string {
  if (transfer.status === "done") return t("sftp.transfers.done");
  if (transfer.status === "cancelled") return t("sftp.transfers.cancelled");
  // An upload refused because the dropped item is a folder (T47).
  if (isFolderError(transfer.error)) return t("sftp.transfers.folder");
  return transfer.error ? describeError(transfer.error).title : t("sftp.transfers.failed");
}

/** An upload refused because the dropped item is a folder, not a file (T47). */
function isFolderError(error: AppError | null): boolean {
  return (
    error != null && error.kind === "validation" && error.message === "localPath: is a directory"
  );
}

async function reveal(path: string): Promise<void> {
  try {
    await revealInFolder(path);
  } catch (error) {
    notifyError(error);
  }
}

/** The action on the right of a line: Cancel while it runs, Show in folder once a download is done. */
function rowAction(transfer: Transfer, t: TFunction) {
  if (transfer.status === "running") {
    const label = t("sftp.transfers.cancel", { name: transfer.name });
    return (
      <IconButton
        size="xs"
        variant="ghost"
        label={label}
        onClick={() => useTransfers.getState().cancel(transfer.id)}
      >
        <X aria-hidden />
      </IconButton>
    );
  }
  const path = transfer.path;
  if (transfer.status !== "done" || transfer.direction !== "download" || !path) return null;
  return (
    <IconButton
      size="xs"
      variant="ghost"
      label={t("sftp.transfers.reveal", { name: transfer.name })}
      onClick={() => void reveal(path)}
    >
      <FolderOpen aria-hidden />
    </IconButton>
  );
}

/** One transfer line: direction arrow, name, progress or final state, and its action on the right. */
function TransferRow({ transfer, locale }: { transfer: Transfer; locale: string }) {
  const { t } = useTranslation();
  const pct = percentOf(transfer);
  const Arrow = transfer.direction === "download" ? ChevronDown : ChevronUp;

  return (
    <li aria-label={transfer.name} className="flex items-center gap-2 px-2 py-1">
      <Arrow className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{transfer.name}</span>
      {transfer.status === "running" ? (
        <span className="flex w-56 shrink-0 items-center gap-2">
          <Progress aria-label={transfer.name} value={pct ?? 0} className="w-24 shrink-0" />
          <span className="w-8 shrink-0 text-right text-xs text-muted-foreground">
            {pct ?? 0} %
          </span>
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {t("sftp.transfers.rate", { rate: formatSize(transfer.bytesPerSec, locale) })}
          </span>
        </span>
      ) : (
        <span
          className={cn(
            "w-56 shrink-0 truncate",
            transfer.status === "failed" && "text-destructive",
          )}
        >
          {statusText(transfer, t)}
        </span>
      )}
      <span className="flex size-6 shrink-0 items-center justify-center">
        {rowAction(transfer, t)}
      </span>
    </li>
  );
}

/**
 * The transfers panel for one session. Reads the store, keeps only this session's transfers in a `useMemo` over
 * the list (never `s.transfers.filter` in the selector, or a new array would rerender it into a loop), and goes
 * away when the session has none.
 */
export function TransfersPanel({ sessionId }: TransfersPanelProps) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(true);

  const transfers = useTransfers((state) => state.transfers);
  const active = useMemo(
    () => Object.values(transfers).filter((transfer) => transfer.sessionId === sessionId),
    [transfers, sessionId],
  );

  if (active.length === 0) return null;

  const locale = i18n.language;
  const finished = active.some((transfer) => transfer.status !== "running");

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-t border-border">
      <div className="flex items-center gap-1 px-2 py-1">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1">
            <ChevronDown
              className={cn(
                "size-3.5 shrink-0 transition-transform",
                open ? "rotate-0" : "-rotate-90",
              )}
              aria-hidden
            />
            {t("sftp.transfers.title", { count: active.length })}
          </Button>
        </CollapsibleTrigger>
        {finished && (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => useTransfers.getState().clearFinished(sessionId)}
          >
            {t("sftp.transfers.clear")}
          </Button>
        )}
      </div>
      <CollapsibleContent>
        <ul aria-label={t("sftp.transfers.list")} className="max-h-40 w-full overflow-auto">
          {active.map((transfer) => (
            <TransferRow key={transfer.id} transfer={transfer} locale={locale} />
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
