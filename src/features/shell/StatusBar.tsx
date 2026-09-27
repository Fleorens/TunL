import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ProtocolBadge } from "@/components/ProtocolBadge";
import { Badge } from "@/components/ui/badge";
import { useConnections } from "@/features/connections/store";
import { useDemoTabs } from "@/features/shell/demo-data";
import { notifyError } from "@/lib/errors";
import { ipc, isMockBackend } from "@/lib/ipc";

export function StatusBar() {
  const { t } = useTranslation();
  const activeTab = useDemoTabs((state) => state.tabs.find((tab) => tab.id === state.activeId));
  const connectionId = activeTab?.connectionId ?? null;

  // Only the active connection, looked up in the live store. In Tauri these ids do
  // not exist yet (until T21), so `connection` is undefined and no address shows.
  const connections = useConnections((state) => state.connections);
  const connection = useMemo(
    () => (connectionId !== null ? connections.find((c) => c.id === connectionId) : undefined),
    [connections, connectionId],
  );

  // The bastion is a separate connection, referenced by jumpHostId.
  const jumpHostName = useMemo(() => {
    if (!connection?.jumpHostId) return null;
    return connections.find((c) => c.id === connection.jumpHostId)?.name ?? null;
  }, [connections, connection]);

  const activeCount = useDemoTabs(
    (state) => state.tabs.filter((tab) => tab.status === "online").length,
  );

  const address = connection
    ? `${connection.username ? `${connection.username}@` : ""}${connection.host}:${connection.port}`
    : null;

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
          {activeTab && (
            <>
              <ProtocolBadge protocol={activeTab.protocol} />
              {address && <span>{address}</span>}
              {jumpHostName && <span>{t("statusbar.via", { name: jumpHostName })}</span>}
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
