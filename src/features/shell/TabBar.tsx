// The row of session tabs, from the store: each with its status dot, protocol, close, and a `+`
// that opens the palette in quick connect.
import { Plus, X } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { ProtocolIcon } from "@/components/ProtocolIcon";
import { StatusDot } from "@/components/StatusDot";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Session } from "@/features/sessions/session-model";
import { tabStatus } from "@/features/sessions/session-model";
import { useSessions } from "@/features/sessions/store";
import { useUi } from "@/features/shell/ui-store";
import { cn } from "@/lib/utils";

function Tab({
  session,
  active,
  activate,
  close,
}: {
  session: Session;
  active: boolean;
  activate: (id: string) => void;
  close: (id: string) => void;
}) {
  const { t } = useTranslation();
  const status = tabStatus(session.status);
  return (
    <div
      role="tab"
      tabIndex={active ? 0 : -1}
      aria-selected={active}
      onClick={() => activate(session.id)}
      onAuxClick={(event) => {
        if (event.button === 1) close(session.id);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") activate(session.id);
      }}
      className={cn(
        "group/tab relative flex h-9 min-w-30 max-w-55 cursor-default items-center gap-2 rounded-t-lg px-3 text-sm transition-colors duration-120",
        active
          ? "bg-background text-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
      )}
    >
      <StatusDot status={status} label={t(`status.${status}`)} />
      <ProtocolIcon protocol="ssh" className="size-3.5" />
      <span className="truncate">{session.title}</span>
      <button
        type="button"
        aria-label={t("tabs.close", { name: session.title })}
        onClick={(event) => {
          event.stopPropagation();
          close(session.id);
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
  const { sessions, activeId, activate, requestClose } = useSessions();

  return (
    <div
      role="tablist"
      aria-label={t("tabs.label")}
      className="flex h-10 shrink-0 items-end gap-0.5 overflow-x-auto bg-sidebar px-2 select-none"
    >
      {sessions.map((session) => (
        <Tab
          key={session.id}
          session={session}
          active={session.id === activeId}
          activate={activate}
          close={requestClose}
        />
      ))}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t("tabs.new")}
            onClick={() => useUi.getState().openPalette("quickConnect")}
          >
            <Plus className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("tabs.new")}</TooltipContent>
      </Tooltip>
    </div>
  );
}
