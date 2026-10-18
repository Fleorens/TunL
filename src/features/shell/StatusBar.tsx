// The footer: how many sessions are connected, and, for the active tab, its protocol, address, bastion, size.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Connection } from "@/bindings/Connection";
import { ProtocolBadge } from "@/components/ProtocolBadge";
import { Badge } from "@/components/ui/badge";
import { jumpChainNames } from "@/features/connections/jump-hosts";
import { useConnections } from "@/features/connections/store";
import type { Session } from "@/features/sessions/session-model";
import { useSessions } from "@/features/sessions/store";
import { notifyError } from "@/lib/errors";
import { ipc, isMockBackend } from "@/lib/ipc";

export function StatusBar() {
  const { t } = useTranslation();
  const sessions = useSessions((state) => state.sessions);
  const activeId = useSessions((state) => state.activeId);
  const connections = useConnections((state) => state.connections);

  const active = useMemo(
    () => sessions.find((session) => session.id === activeId) ?? null,
    [sessions, activeId],
  );
  const activeCount = useMemo(
    () => sessions.filter((session) => session.status === "connected").length,
    [sessions],
  );

  const address = active ? sessionAddress(active, connections) : null;
  const bastion = active ? bastionChain(active, connections) : null;
  const size = active?.size ?? null;

  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    ipc
      .appInfo()
      .then((info) => {
        if (!cancelled) setVersion(info.version);
      })
      .catch((error: unknown) => {
        if (!cancelled) notifyError(error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <footer className="flex h-7 shrink-0 items-center justify-between border-t bg-sidebar px-3 text-xs text-muted-foreground select-none">
      <span>{activeCount > 0 && t("statusbar.activeSessions", { count: activeCount })}</span>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 font-mono">
          {active && (
            <>
              <ProtocolBadge protocol="ssh" />
              {address && <span>{address}</span>}
              {bastion && <span>{t("statusbar.via", { name: bastion })}</span>}
              {size && <span>{t("statusbar.size", { cols: size.cols, rows: size.rows })}</span>}
            </>
          )}
        </div>
        {version && (
          <span className="flex items-center gap-1 text-subtle-foreground">
            {isMockBackend && <Badge variant="outline">{t("statusbar.mockBackend")}</Badge>}
            {t("statusbar.version", { version })}
          </span>
        )}
      </div>
    </footer>
  );
}

/** The active tab's address: from the saved connection, or from a quick target. `user@host:port`, or `host:port` without a user. */
function sessionAddress(session: Session, connections: readonly Connection[]): string | null {
  const target = session.target;
  if (target.type === "saved") {
    const connection = connections.find((c) => c.id === target.connectionId);
    if (!connection) return null;
    return `${connection.username ? `${connection.username}@` : ""}${connection.host}:${connection.port}`;
  }
  const { host, port, username } = target;
  return `${username ? `${username}@` : ""}${host}:${port}`;
}

/**
 * The bastion chain of a saved connection, names joined `nas → bastion-01`, or null (a quick target, or one
 * with no jump host). Uses `jumpChainNames`, the user's side of the chain (outermost bastion first).
 */
function bastionChain(session: Session, connections: readonly Connection[]): string | null {
  const target = session.target;
  if (target.type !== "saved") return null;
  const connection = connections.find((c) => c.id === target.connectionId);
  const chain = jumpChainNames(connections, connection?.jumpHostId ?? "");
  return chain.length === 0 ? null : chain.join(" → ");
}
