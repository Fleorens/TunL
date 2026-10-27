// The RDP session card (T28b): a connection runs FreeRDP in its own window, so a tab shows this card instead of a
// terminal — its status, why a session ended, the bastion tunnel, disconnect/relaunch, and the filtered client log.
import { Monitor } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { StatusDot } from "@/components/StatusDot";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { jumpChainNames } from "@/features/connections/jump-hosts";
import { useConnections } from "@/features/connections/store";
import type { Session } from "@/features/sessions/session-model";
import { useSessions } from "@/features/sessions/store";
import { useUi } from "@/features/shell/ui-store";
import { exitKey, minutesSince, tunnelAddress } from "./rdp-model";

/** The RDP card: centered, a fixed width, the connection, its status, controls, and the log. */
export function RdpCard({ session }: { session: Session }) {
  const { t } = useTranslation();
  const connections = useConnections((state) => state.connections);
  const connectionId = session.target.type === "saved" ? session.target.connectionId : null;
  const connection = connectionId ? connections.find((c) => c.id === connectionId) : null;
  // A reconnect remounts this card (its key is `rdp-${runId}`), so the timer starts fresh each time.
  const started = useRef(Date.now());
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((tick) => tick + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  const minutes = minutesSince(started.current, Date.now());

  const address = connection
    ? `${connection.username ? `${connection.username}@` : ""}${connection.host}:${connection.port}`
    : null;
  const bastion = connection
    ? jumpChainNames(connections, connection.jumpHostId ?? "").join(" → ")
    : null;
  const tunnel = tunnelAddress(session.log);

  return (
    <div className="flex h-full items-center justify-center overflow-auto p-4">
      <section
        aria-label={t("rdp.card.label", { name: session.title })}
        className="flex w-110 max-w-full flex-col rounded-xl border bg-card shadow-elevated p-6"
      >
        <div className="flex items-center gap-4">
          <span className="flex items-center justify-center rounded-2xl bg-brand-soft p-4">
            <Monitor className="size-7 text-protocol-rdp" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{session.title}</p>
            {address && (
              <p className="truncate font-mono text-sm text-muted-foreground">{address}</p>
            )}
          </div>
        </div>

        {session.status === "connected" ? (
          <OpenFor minutes={minutes} />
        ) : (
          <EndedBecause exitStatus={session.exitStatus} />
        )}

        {bastion && (
          <p className="mt-2 text-sm text-muted-foreground">
            {tunnel
              ? t("rdp.card.viaTunnel", { chain: bastion, address: tunnel })
              : t("rdp.card.via", { chain: bastion })}
          </p>
        )}

        <div className="mt-4 flex gap-2">
          {session.status === "connected" ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => useSessions.getState().requestClose(session.id)}
            >
              {t("rdp.card.disconnect")}
            </Button>
          ) : (
            <>
              {connection && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => useUi.getState().openEditor({ mode: "edit", id: connection.id })}
                >
                  {t("sessions.error.edit")}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => useSessions.getState().close(session.id)}
              >
                {t("rdp.card.closeTab")}
              </Button>
              <Button size="sm" onClick={() => useSessions.getState().reconnect(session.id)}>
                {t("rdp.card.relaunch")}
              </Button>
            </>
          )}
        </div>

        <LogPanel log={session.log} />
      </section>
    </div>
  );
}

/** The connected duration: a green dot, then "Session open · N min" (refreshed every 30 seconds). */
function OpenFor({ minutes }: { minutes: number }) {
  const { t } = useTranslation();
  return (
    <div className="mt-4 flex items-center gap-2">
      <StatusDot status="online" label={t("status.online")} />
      <span className="text-sm">{t("rdp.card.open", { count: minutes })}</span>
    </div>
  );
}

/** Why a session ended: the exit code translated into a phrase, then "(code N)" when it is not a clean end. */
function EndedBecause({ exitStatus }: { exitStatus: number | null }) {
  const { t } = useTranslation();
  const ended = exitKey(exitStatus) === "ended";
  return (
    <p className={ended ? "mt-4 text-sm text-muted-foreground" : "mt-4 text-sm text-destructive"}>
      {t(`rdp.exit.${exitKey(exitStatus)}`)}
      {!ended && exitStatus !== null && <span> {t("rdp.card.code", { code: exitStatus })}</span>}
    </p>
  );
}

/** The collapsible, filtered client log: a pre with the lines, or "Nothing logged yet." */
function LogPanel({ log }: { log: readonly string[] }) {
  const { t } = useTranslation();
  return (
    <Collapsible className="mt-4">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1 self-start text-muted-foreground">
          {t("rdp.card.log")}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre
          role="log"
          aria-label={t("rdp.card.log")}
          className="mt-2 max-h-48 overflow-auto font-mono text-[11px]"
        >
          {log.length === 0 ? t("rdp.card.logEmpty") : log.join("\n")}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}
