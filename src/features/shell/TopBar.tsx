import { PanelLeft, Plus, Search, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/IconButton";
import { Logo, Wordmark } from "@/components/Logo";
import { ShortcutHint } from "@/components/ShortcutHint";
import { Button } from "@/components/ui/button";
import { useSessions } from "@/features/sessions/store";
import { useUi } from "@/features/shell/ui-store";
import { WindowControls } from "@/features/shell/WindowControls";

export function TopBar() {
  const { t } = useTranslation();
  const toggleSidebar = useUi((state) => state.toggleSidebar);
  const custom = useUi((state) => state.windowChrome.mode === "custom");
  // Present (empty) with the TunL title bar only: React would write `="false"` for a `false` value.
  const drag = custom ? "" : undefined;

  return (
    <header
      data-tauri-drag-region={drag}
      className="flex h-12 shrink-0 items-center gap-2 border-b bg-sidebar px-2 select-none"
    >
      <IconButton
        variant="ghost"
        size="sm"
        label={t("topbar.toggleSidebar")}
        onClick={toggleSidebar}
      >
        <PanelLeft className="size-4" />
      </IconButton>

      {/* Tauri's drag script skips SVG elements and only honours an empty attribute on the clicked element
          itself: the logo lets the click through to the header, the name covers its inner « L » with "deep". */}
      <Logo size={20} className={custom ? "pointer-events-none" : undefined} />
      <Wordmark data-tauri-drag-region={custom ? "deep" : undefined} />

      <div data-tauri-drag-region={drag} className="flex flex-1 justify-center">
        <button
          type="button"
          onClick={() => useUi.getState().openPalette("all")}
          className="flex h-8 w-full max-w-115 items-center gap-2 rounded-md border bg-background/60 px-3 text-muted-foreground transition-colors duration-120 hover:border-border-strong hover:text-foreground"
        >
          <Search className="size-4" />
          <span className="flex-1 truncate text-left">{t("topbar.searchPlaceholder")}</span>
          <ShortcutHint keys={["Ctrl", "⇧", "P"]} />
        </button>
      </div>

      <Button size="sm" onClick={() => useUi.getState().openEditor({ mode: "create" })}>
        <Plus className="size-4" />
        {t("topbar.newConnection")}
      </Button>

      <IconButton
        variant="ghost"
        size="sm"
        label={t("topbar.settings")}
        onClick={() => useSessions.getState().openSettings()}
      >
        <Settings2 className="size-4" />
      </IconButton>

      {custom && (
        <>
          <div className="mx-1 h-6 w-px bg-border" />
          <WindowControls />
        </>
      )}
    </header>
  );
}
