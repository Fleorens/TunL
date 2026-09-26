import { Plus, X } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { ProtocolIcon } from "@/components/ProtocolIcon";
import { StatusDot } from "@/components/StatusDot";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { notifyComingSoon } from "@/features/shell/coming-soon";
import type { DemoTab } from "@/features/shell/demo-data";
import { useDemoTabs } from "@/features/shell/demo-data";
import { cn } from "@/lib/utils";

function Tab({
  tab,
  active,
  activate,
  close,
}: {
  tab: DemoTab;
  active: boolean;
  activate: (id: string) => void;
  close: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="tab"
      tabIndex={active ? 0 : -1}
      aria-selected={active}
      onClick={() => activate(tab.id)}
      onAuxClick={(event) => {
        if (event.button === 1) close(tab.id);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") activate(tab.id);
      }}
      className={cn(
        "group/tab relative flex h-9 min-w-30 max-w-55 cursor-default items-center gap-2 rounded-t-lg px-3 text-sm transition-colors duration-120",
        active
          ? "bg-background text-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
      )}
    >
      <StatusDot status={tab.status} label={t(`status.${tab.status}`)} />
      <ProtocolIcon protocol={tab.protocol} className="size-3.5" />
      <span className="truncate">{tab.title}</span>
      <button
        type="button"
        aria-label={t("tabs.close", { name: tab.title })}
        onClick={(event) => {
          event.stopPropagation();
          close(tab.id);
        }}
        className={cn(
          "ml-auto rounded-sm p-0.5 text-muted-foreground opacity-0 transition-opacity duration-120 hover:bg-muted hover:text-foreground group-hover/tab:opacity-100 focus-visible:opacity-100",
          active && "opacity-100",
        )}
      >
        <X className="size-3.5" />
      </button>
      {active && (
        <motion.span
          layoutId="tab-indicator"
          className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-brand-gradient"
          transition={{ type: "spring", stiffness: 500, damping: 38 }}
        />
      )}
    </div>
  );
}

export function TabBar() {
  const { t } = useTranslation();
  const { tabs, activeId, activate, close } = useDemoTabs();

  return (
    <div
      role="tablist"
      aria-label={t("tabs.label")}
      className="flex h-10 shrink-0 items-end gap-0.5 overflow-x-auto bg-sidebar px-2 select-none"
    >
      {tabs.map((tab) => (
        <Tab
          key={tab.id}
          tab={tab}
          active={tab.id === activeId}
          activate={activate}
          close={close}
        />
      ))}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t("tabs.new")}
            onClick={notifyComingSoon}
          >
            <Plus className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("tabs.new")}</TooltipContent>
      </Tooltip>
    </div>
  );
}
