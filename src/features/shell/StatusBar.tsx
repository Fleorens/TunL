import { useTranslation } from "react-i18next";
import { ProtocolBadge } from "@/components/ProtocolBadge";
import { DEMO_CONNECTIONS, useDemoTabs } from "@/features/shell/demo-data";

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

  return (
    <footer className="flex h-7 shrink-0 items-center justify-between border-t bg-sidebar px-3 text-xs text-muted-foreground select-none">
      <span>{activeCount > 0 && t("statusbar.activeSessions", { count: activeCount })}</span>
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
    </footer>
  );
}
