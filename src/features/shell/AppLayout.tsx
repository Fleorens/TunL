import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { usePanelRef } from "react-resizable-panels";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { HomeView } from "@/features/home/HomeView";
import { useDemoTabs } from "@/features/shell/demo-data";
import { StatusBar } from "@/features/shell/StatusBar";
import { Sidebar } from "@/features/shell/sidebar/Sidebar";
import { TabBar } from "@/features/shell/TabBar";
import { TopBar } from "@/features/shell/TopBar";
import { useUi } from "@/features/shell/ui-store";
import { type ShortcutHandlers, useGlobalShortcuts } from "@/features/shell/use-global-shortcuts";

export function AppLayout() {
  const { t } = useTranslation();
  const panelRef = usePanelRef();
  const collapsed = useUi((state) => state.sidebarCollapsed);
  const setSidebarCollapsed = useUi((state) => state.setSidebarCollapsed);
  const toggleSidebar = useUi((state) => state.toggleSidebar);
  const activeId = useDemoTabs((state) => state.activeId);
  const activeTab = useDemoTabs((state) => state.tabs.find((tab) => tab.id === state.activeId));

  // The store is the source of truth; the panel follows it.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    if (collapsed && !panel.isCollapsed()) panel.collapse();
    if (!collapsed && panel.isCollapsed()) panel.expand();
  }, [collapsed, panelRef]);

  const handlers: ShortcutHandlers = {
    "sidebar.toggle": () => toggleSidebar(),
    "sidebar.filter": () => {
      if (collapsed) setSidebarCollapsed(false);
      document.getElementById("sidebar-filter")?.focus();
    },
    "tab.next": () => useDemoTabs.getState().activateRelative(1),
    "tab.previous": () => useDemoTabs.getState().activateRelative(-1),
    "tab.close": () => {
      const current = useDemoTabs.getState().activeId;
      if (current) useDemoTabs.getState().close(current);
    },
    "tab.goTo1": () => useDemoTabs.getState().activateIndex(0),
    "tab.goTo2": () => useDemoTabs.getState().activateIndex(1),
    "tab.goTo3": () => useDemoTabs.getState().activateIndex(2),
    "tab.goTo4": () => useDemoTabs.getState().activateIndex(3),
    "tab.goTo5": () => useDemoTabs.getState().activateIndex(4),
    "tab.goTo6": () => useDemoTabs.getState().activateIndex(5),
    "tab.goTo7": () => useDemoTabs.getState().activateIndex(6),
    "tab.goTo8": () => useDemoTabs.getState().activateIndex(7),
    "tab.goTo9": () => {
      const tabs = useDemoTabs.getState().tabs;
      if (tabs.length > 0) useDemoTabs.getState().activateIndex(tabs.length - 1);
    },
  };
  useGlobalShortcuts(handlers);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <TopBar />
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel
          panelRef={panelRef}
          defaultSize={272}
          minSize={220}
          maxSize={400}
          collapsible
          collapsedSize={0}
          onResize={(size) => setSidebarCollapsed(size.inPixels === 0)}
        >
          <Sidebar />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel className="flex h-full min-w-0 flex-col">
          <TabBar />
          <div className="relative min-h-0 flex-1">
            {activeId === null ? (
              <HomeView />
            ) : (
              <div className="flex h-full items-center justify-center">
                <p className="text-muted-foreground">
                  {t("shell.sessionPlaceholder", { name: activeTab?.title })}
                </p>
              </div>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
      <StatusBar />
    </div>
  );
}
