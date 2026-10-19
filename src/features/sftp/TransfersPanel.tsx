// The transfers panel, folded under the SFTP explorer (docs/04 §6): one collapsible, open by default, with a
// header ("Transfers (n)" that folds it, "Clear finished" when something is done) and one line per transfer.
// Pure view of the store: it reads the transfers of its session, starts and cancels them, and never builds the
// event channel (that is the mock/Tauri side, T26).
import { ChevronDown, ChevronUp } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { describeError } from "@/lib/errors";
import { revealInFolder } from "@/lib/opener";
import { cn } from "@/lib/utils";
import { formatSize } from "./sftp-model";
import { percentOf, type Transfer } from "./transfer-model";
import { useTransfers } from "./transfers-store";

interface TransfersPanelProps {
  sessionId: string;
}

/** One transfer line: direction arrow, name, progress or final state, and its action on the right. */
function TransferRow({ transfer, locale }: { transfer: Transfer; locale: string }) {
  const { t } = useTranslation();
  const running = transfer.status === "running";
  const pct = percentOf(transfer);
  const Arrow = transfer.direction === "download" ? ChevronDown : ChevronUp;
  const statusText =
    transfer.status === "done"
      ? t("sftp.transfers.done")
      : transfer.status === "cancelled"
        ? t("sftp.transfers.cancelled")
        : describeError(transfer.error ?? { kind: "internal", message: "", detail: null }).title;

  return (
    <li aria-label={transfer.name} className="flex items-center gap-2 px-2 py-1">
      <Arrow className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{transfer.name}</span>
      {running ? (
        <span className="flex min-w-0 items-center gap-2">
          <Progress aria-label={transfer.name} value={pct ?? 0} className="w-24 shrink-0" />
          <span className="w-8 shrink-0 text-right text-xs text-muted-foreground">
            {pct ?? 0} %
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {t("sftp.transfers.rate", { rate: formatSize(transfer.bytesPerSec, locale) })}
          </span>
        </span>
      ) : (
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            transfer.status === "failed" && "text-destructive",
          )}
        >
          {statusText}
        </span>
      )}
      <span className="ml-auto shrink-0">
        {running ? (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => useTransfers.getState().cancel(transfer.id)}
          >
            {t("sftp.transfers.cancel", { name: transfer.name })}
          </Button>
        ) : transfer.status === "done" ? (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => void revealInFolder(transfer.path ?? "")}
          >
            {t("sftp.transfers.reveal", { name: transfer.name })}
          </Button>
        ) : null}
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
                open ? "rotate-0" : "rotate-90",
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
