import { PanelLeft, Plus, Search, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Logo, Wordmark } from "@/components/Logo";
import { ShortcutHint } from "@/components/ShortcutHint";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { notifyComingSoon } from "@/features/shell/coming-soon";
import { useUi } from "@/features/shell/ui-store";

export function TopBar() {
  const { t } = useTranslation();
  const toggleSidebar = useUi((state) => state.toggleSidebar);

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-sidebar px-2 select-none">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("topbar.toggleSidebar")}
            onClick={toggleSidebar}
          >
            <PanelLeft className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("topbar.toggleSidebar")}</TooltipContent>
      </Tooltip>

      <Logo size={20} />
      <Wordmark />

      <div className="flex flex-1 justify-center">
        <button
          type="button"
          onClick={notifyComingSoon}
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

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("topbar.settings")}
            onClick={notifyComingSoon}
          >
            <Settings2 className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("topbar.settings")}</TooltipContent>
      </Tooltip>
    </header>
  );
}
