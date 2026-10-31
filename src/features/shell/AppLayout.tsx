import { useEffect } from "react";
import { usePanelRef } from "react-resizable-panels";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ConnectionEditor } from "@/features/connections/editor/ConnectionEditor";
import { HomeView } from "@/features/home/HomeView";
import { ImportDialog } from "@/features/import/ImportDialog";
import { CommandPalette } from "@/features/palette/CommandPalette";
import { ShortcutsDialog } from "@/features/palette/ShortcutsDialog";
import { PromptHost } from "@/features/prompts/PromptHost";
import { useReachabilityPolling } from "@/features/reachability/use-reachability-polling";
import { CloseSessionDialog } from "@/features/sessions/CloseSessionDialog";
import { SessionView } from "@/features/sessions/SessionView";
import { useSessions } from "@/features/sessions/store";
import { SETTINGS_TAB } from "@/features/sessions/tabs";
import { SettingsView } from "@/features/settings/SettingsView";
import { StatusBar } from "@/features/shell/StatusBar";
import { Sidebar } from "@/features/shell/sidebar/Sidebar";
import { TabBar } from "@/features/shell/TabBar";
import { TopBar } from "@/features/shell/TopBar";
import { useUi } from "@/features/shell/ui-store";
import { type ShortcutHandlers, useGlobalShortcuts } from "@/features/shell/use-global-shortcuts";
import { useWindowChrome } from "@/features/shell/use-window-chrome";
import { cn } from "@/lib/utils";

export function AppLayout() {
  const panelRef = usePanelRef();
  const collapsed = useUi((state) => state.sidebarCollapsed);
  const setSidebarCollapsed = useUi((state) => state.setSidebarCollapsed);
  const toggleSidebar = useUi((state) => state.toggleSidebar);
  const sessions = useSessions((state) => state.sessions);
  const activeId = useSessions((state) => state.activeId);
  const settingsOpen = useSessions((state) => state.settingsOpen);
  const windowChrome = useUi((state) => state.windowChrome);
  const maximized = useUi((state) => state.maximized);

  // The store is the source of truth; the panel follows it.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    if (collapsed && !panel.isCollapsed()) panel.collapse();
    if (!collapsed && panel.isCollapsed()) panel.expand();
  }, [collapsed, panelRef]);

  const handlers: ShortcutHandlers = {
    "sidebar.toggle": () => toggleSidebar(),
    "connection.new": () => useUi.getState().openEditor({ mode: "create" }),
    "palette.open": () => useUi.getState().openPalette("all"),
    "palette.quickConnect": () => useUi.getState().openPalette("quickConnect"),
    "help.shortcuts": () => useUi.getState().openShortcuts(),
    "settings.open": () => useSessions.getState().openSettings(),
    "sidebar.filter": () => {
      if (collapsed) setSidebarCollapsed(false);
      document.getElementById("sidebar-filter")?.focus();
    },
    "tab.next": () => useSessions.getState().activateRelative(1),
    "tab.previous": () => useSessions.getState().activateRelative(-1),
    "tab.moveLeft": () => useSessions.getState().moveActive(-1),
    "tab.moveRight": () => useSessions.getState().moveActive(1),
    "tab.close": () => {
      const current = useSessions.getState().activeId;
      if (current) useSessions.getState().requestClose(current);
    },
    "tab.goTo1": () => useSessions.getState().activateIndex(0),
    "tab.goTo2": () => useSessions.getState().activateIndex(1),
    "tab.goTo3": () => useSessions.getState().activateIndex(2),
    "tab.goTo4": () => useSessions.getState().activateIndex(3),
    "tab.goTo5": () => useSessions.getState().activateIndex(4),
    "tab.goTo6": () => useSessions.getState().activateIndex(5),
    "tab.goTo7": () => useSessions.getState().activateIndex(6),
    "tab.goTo8": () => useSessions.getState().activateIndex(7),
    "tab.goTo9": () => {
      const tabs = useSessions.getState().sessions;
      if (tabs.length > 0) useSessions.getState().activateIndex(tabs.length - 1);
    },
  };
  useGlobalShortcuts(handlers);
  useReachabilityPolling();
  useWindowChrome();

  return (
    <div
      className={cn(
        "flex h-dvh flex-col overflow-hidden bg-background",
        windowChrome.mode === "custom" && !maximized && "border",
      )}
    >
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
            {sessions.length === 0 && !settingsOpen ? (
              <HomeView />
            ) : (
              <>
                {sessions.map((session) => (
                  <SessionView
                    key={session.id}
                    session={session}
                    active={session.id === activeId}
                  />
                ))}
                {settingsOpen && <SettingsView active={activeId === SETTINGS_TAB} />}
              </>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
      <StatusBar />
      <ConnectionEditor />
      <ImportDialog />
      <CommandPalette />
      <ShortcutsDialog />
      <CloseSessionDialog />
      <PromptHost />
    </div>
  );
}
