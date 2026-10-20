// One session tab: the terminal, always mounted, plus one overlay for its status (connecting, error, ended).
// The section is hidden while another tab is active; the terminal stays mounted so it is back when you return.
import { Check, Loader2, ShieldAlert, Unplug, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useConnections } from "@/features/connections/store";
import { HostKeyChangedCard } from "@/features/prompts/HostKeyChangedCard";
import { RdpCard } from "@/features/rdp/RdpCard";
import { RdpMissingCard } from "@/features/rdp/RdpMissingCard";
import { SftpExplorer } from "@/features/sftp/SftpExplorer";
import { useUi } from "@/features/shell/ui-store";
import { TerminalView } from "@/features/terminal/TerminalView";
import { describeError } from "@/lib/errors";
import { stepKey, type Session, type SessionStepView } from "./session-model";
import { getSessionPort } from "./session-ports";
import { useSessions } from "./store";

/** The tab's terminal, and the overlay matching its status. */
export function SessionView({ session, active }: { session: Session; active: boolean }) {
  const sessionPort = getSessionPort(session.id);
  const port = sessionPort?.port ?? null;
  // Edit connection only while the saved connection still exists (it may have been deleted since).
  const editable = useConnections((state) =>
    state.connections.some((c) => c.id === session.connectionId),
  );
  // An SSH tab renders its terminal only once it has a port; an SFTP tab has none and renders the
  // explorer only when connected (the home is not ready before then, under the overlays and banner).
  if (session.kind === "ssh" && !port) return null;
  return (
    <section aria-label={session.title} hidden={!active} className="flex h-full flex-col">
      <div className="relative min-h-0 flex-1">
        {session.kind === "ssh" && port ? (
          <TerminalView port={port} active={active} />
        ) : session.kind === "sftp" ? (
          session.status === "connected" ? (
            <SftpExplorer key={session.runId} sessionId={session.runId} />
          ) : null
        ) : session.kind === "rdp" ? (
          session.status !== "connecting" ? (
            <RdpCard key={`rdp-${session.runId}`} session={session} />
          ) : null
        ) : null}
        <AnimatePresence>
          {session.status === "connecting" && (
            <ConnectingOverlay key="connecting" session={session} onClose={cancel(session.id)} />
          )}
          {session.status === "error" &&
            (session.error?.kind === "rdpClientMissing" ? (
              <RdpMissingCard
                key="missing"
                onRetry={reconnect(session.id)}
                onClose={cancel(session.id)}
              />
            ) : (
              <SessionErrorCard
                key="error"
                session={session}
                onRetry={reconnect(session.id)}
                onEdit={editable ? edit(session.connectionId) : null}
                onClose={cancel(session.id)}
              />
            ))}
        </AnimatePresence>
      </div>
      {session.kind !== "rdp" && session.status === "closed" && (
        <ClosedBanner
          code={session.exitStatus}
          onReconnect={() => useSessions.getState().reconnect(session.id)}
        />
      )}
    </section>
  );
}

/** The Cancel of the connecting card goes through the same close flow as the tab's close button. */
function cancel(id: string): () => void {
  return () => useSessions.getState().requestClose(id);
}

/** A new attempt on the same tab, with a fresh backend run. */
function reconnect(id: string): () => void {
  return () => useSessions.getState().reconnect(id);
}

function edit(connectionId: string | null): (() => void) | null {
  if (!connectionId) return null;
  return () => useUi.getState().openEditor({ mode: "edit", id: connectionId });
}

/** The connecting card: the steps of this attempt, each started, done, or failed, with a Cancel. */
function ConnectingOverlay({ session, onClose }: { session: Session; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <motion.div
      role="status"
      aria-live="polite"
      className="absolute inset-0 flex h-full w-full items-center justify-center bg-background/60"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
    >
      <div className="flex w-80 max-w-[calc(100%-2rem)] flex-col rounded-lg glass shadow-elevated p-5">
        <p className="text-sm font-medium">{t("sessions.connecting", { name: session.title })}</p>
        <ul className="mt-3 flex flex-col gap-1.5 text-sm">
          {session.steps.map((step) => (
            <StepLine key={`${step.step}:${step.label}`} step={step} />
          ))}
        </ul>
        <Button variant="outline" size="sm" onClick={onClose} className="mt-3 self-end">
          {t("sessions.cancel")}
        </Button>
      </div>
    </motion.div>
  );
}

/** One step line: an icon for its state, then its translated label. */
function StepLine({ step }: { step: SessionStepView }) {
  const { t } = useTranslation();
  const icon =
    step.state === "started" ? (
      <Loader2 className="size-4 animate-spin" />
    ) : step.state === "done" ? (
      <Check className="size-4" />
    ) : (
      <X className="size-4 text-destructive" />
    );
  return (
    <li className="flex items-center gap-2">
      <span aria-hidden className="inline-flex size-4 items-center justify-center">
        {icon}
      </span>
      <span className="min-w-0 truncate">
        {t(stepKey(step), { label: step.label })}
      </span>
    </li>
  );
}

/** The error card: what failed, an expandable detail, and Retry (plus Edit connection when saved). */
function SessionErrorCard({
  session,
  onRetry,
  onEdit,
  onClose,
}: {
  session: Session;
  onRetry: () => void;
  onEdit: (() => void) | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const error = session.error;
  if (!error) return null;
  // A changed host key has its own card: explain the refusal, offer to remove the old key, reconnect.
  if (error.detail?.type === "hostKeyChanged") {
    return (
      <HostKeyChangedCard
        name={session.title}
        detail={error.detail}
        onReconnect={onRetry}
        onClose={onClose}
      />
    );
  }
  const hostKey = error.kind === "hostKeyRejected" || error.kind === "hostKeyChanged";
  return (
    <motion.div
      role="alert"
      className="absolute inset-0 flex h-full w-full items-center justify-center bg-background/60"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
    >
      <div className="flex w-80 max-w-[calc(100%-2rem)] flex-col rounded-lg glass shadow-elevated p-5">
        <div className="flex items-center gap-2">
          {hostKey ? <ShieldAlert className="size-4" /> : <Unplug className="size-4" />}
          <p className="text-sm font-medium">{describeError(error).title}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          className="mt-3 self-start text-muted-foreground"
        >
          {t("sessions.error.details")}
        </Button>
        {open && (
          <p className="mt-1 font-mono text-xs break-words whitespace-pre-wrap text-muted-foreground">
            {error.message}
          </p>
        )}
        <div className="mt-3 flex justify-end gap-2">
          {onEdit && (
            <Button variant="outline" size="sm" onClick={onEdit}>
              {t("sessions.error.edit")}
            </Button>
          )}
          <Button size="sm" onClick={onRetry}>
            {t("sessions.error.retry")}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

/** The end banner under the terminal: the exit code, and a Reconnect. The terminal keeps its last line visible. */
function ClosedBanner({ code, onReconnect }: { code: number | null; onReconnect: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-t bg-card px-3 py-1.5 text-xs">
      <span className="text-muted-foreground">
        {code === null ? t("sessions.closed.withoutCode") : t("sessions.closed.withCode", { code })}
      </span>
      <Button variant="outline" size="xs" onClick={onReconnect}>
        {t("sessions.reconnect")}
      </Button>
    </div>
  );
}
