// One session tab: the terminal, always mounted, plus one overlay for its status (connecting, error, ended).
// The section is hidden while another tab is active; the terminal stays mounted so it is back when you return.
import { Check, Loader2, ShieldAlert, Unplug, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useUi } from "@/features/shell/ui-store";
import { TerminalView } from "@/features/terminal/TerminalView";
import { describeError } from "@/lib/errors";
import type { Session, SessionStepView } from "./session-model";
import { useSessionPort } from "./session-ports";
import { useSessions } from "./store";

/** The tab's terminal, and the overlay matching its status. */
export function SessionView({ session, active }: { session: Session; active: boolean }) {
  const sessionPort = useSessionPort(session.id);
  const port = sessionPort?.port ?? null;
  if (!port) return null;
  return (
    <section aria-label={session.title} hidden={!active} className="relative h-full">
      <TerminalView port={port} active={active} />
      <AnimatePresence>
        {session.status === "connecting" && (
          <ConnectingOverlay key="connecting" session={session} onClose={close(session.id)} />
        )}
        {session.status === "error" && (
          <SessionErrorCard
            key="error"
            session={session}
            onRetry={() => useSessions.getState().reconnect(session.id)}
            onEdit={edit(session.connectionId)}
          />
        )}
        {session.status === "closed" && (
          <ClosedBanner
            key="closed"
            code={session.exitStatus}
            onReconnect={() => useSessions.getState().reconnect(session.id)}
          />
        )}
      </AnimatePresence>
    </section>
  );
}

/** The middle button of a tab, and the app-close shortcut, both go through the close flow. */
function close(id: string): () => void {
  return () => useSessions.getState().requestClose(id);
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
      <div className="w-min max-w-[22rem] rounded-lg glass shadow-elevated p-5">
        <p className="text-sm font-medium">{t("sessions.connecting", { name: session.title })}</p>
        <ul className="mt-3 flex flex-col gap-1.5 text-sm">
          {session.steps.map((step) => (
            <StepLine key={step.step} step={step} />
          ))}
        </ul>
        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full rounded-md border bg-card px-2.5 py-1.5 text-xs transition-colors hover:bg-muted"
        >
          {t("sessions.cancel")}
        </button>
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
      <span className="truncate">{t(`sessions.steps.${step.step}`, { label: step.label })}</span>
    </li>
  );
}

/** The error card: what failed, an expandable detail, and Retry (plus Edit connection when saved). */
function SessionErrorCard({
  session,
  onRetry,
  onEdit,
}: {
  session: Session;
  onRetry: () => void;
  onEdit: (() => void) | null;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const error = session.error;
  if (!error) return null;
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
      <div className="w-min max-w-[22rem] rounded-lg glass shadow-elevated p-5">
        <div className="flex items-center gap-2">
          {hostKey ? <ShieldAlert className="size-4" /> : <Unplug className="size-4" />}
          <p className="text-sm font-medium">{describeError(error).title}</p>
        </div>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          className="mt-3 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {t("sessions.error.details")}
        </button>
        {open && (
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{error.message}</p>
        )}
        <div className="mt-3 flex flex-col gap-1.5">
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md bg-brand-gradient px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:opacity-95"
          >
            {t("sessions.error.retry")}
          </button>
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="rounded-md border bg-card px-2.5 py-1.5 text-xs transition-colors hover:bg-muted"
            >
              {t("sessions.error.edit")}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/** The end banner at the bottom of the tab: the exit code, and a Reconnect. The terminal stays readable above. */
function ClosedBanner({ code, onReconnect }: { code: number | null; onReconnect: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 px-3 py-1.5 text-xs">
      <span className="rounded-md bg-card/90 px-2 py-1 text-muted-foreground">
        {code === null ? t("sessions.closed.withoutCode") : t("sessions.closed.withCode", { code })}
      </span>
      <button
        type="button"
        onClick={onReconnect}
        className="pointer-events-auto rounded-md bg-card/90 px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        {t("sessions.reconnect")}
      </button>
    </div>
  );
}
