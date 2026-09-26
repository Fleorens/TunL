import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ProtocolBadge } from "@/components/ProtocolBadge";
import { Badge } from "@/components/ui/badge";
import { DEMO_CONNECTIONS, useDemoTabs } from "@/features/shell/demo-data";
import { notifyError } from "@/lib/errors";
import { ipc, isMockBackend } from "@/lib/ipc";

export function StatusBar() {
  const { t } = useTranslation();
  const activeTab = useDemoTabs((state) => state.tabs.find((tab) => tab.id === state.activeId));
  const connection = DEMO_CONNECTIONS.find((c) => c.id === activeTab?.connectionId);

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
              {connection?.jumpHostName && (
                <span>{t("statusbar.via", { name: connection.jumpHostName })}</span>
              )}
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
