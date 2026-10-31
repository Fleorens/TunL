// The row of tabs, from the store: each with its status dot, protocol, close, and a `+` that opens the
// palette in quick connect. A tab is a `TabFrame` (the shared shell: role, click, middle-click, Enter,
// close button, indicator), whose content is a session's dot and protocol, or the Settings icon.
import { Plus, Settings2, X } from "lucide-react";
import { motion } from "motion/react";
import type { ComponentProps, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/IconButton";
import { ProtocolIcon } from "@/components/ProtocolIcon";
import { StatusDot } from "@/components/StatusDot";
import type { Session } from "@/features/sessions/session-model";
import { tabStatus } from "@/features/sessions/session-model";
import { useSessions } from "@/features/sessions/store";
import { SETTINGS_TAB } from "@/features/sessions/tabs";
import { useUi } from "@/features/shell/ui-store";
import { listMove, moveIndex } from "@/lib/list-keys";
import { cn } from "@/lib/utils";
import { TabMenu } from "./TabMenu";

/** The shared tab shell: role, click, middle-click, Enter, close button, and the active indicator. It is the
`asChild` trigger of a tab's context menu, so it accepts and forwards the rest of the trigger's props. */
function TabFrame({
  id,
  title,
  active,
  activate,
  close,
  closeLabel,
  children,
  ...props
}: {
  id: string;
  title: string;
  active: boolean;
  activate: (id: string) => void;
  close: (id: string) => void;
  closeLabel?: string;
  children: ReactNode;
} & ComponentProps<"div">) {
  const { t } = useTranslation();
  return (
    <div
      {...props}
      role="tab"
      tabIndex={active ? 0 : -1}
      aria-selected={active}
      onClick={() => activate(id)}
      onAuxClick={(event) => {
        if (event.button === 1) close(id);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") activate(id);
      }}
      className={cn(
        "group/tab relative flex h-9 min-w-30 max-w-55 cursor-default items-center gap-2 rounded-t-lg px-3 text-sm transition-colors duration-120",
        active
          ? "bg-background text-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
      )}
    >
      {children}
      <button
        type="button"
        aria-label={closeLabel ?? t("tabs.close", { name: title })}
        onClick={(event) => {
          event.stopPropagation();
          close(id);
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

/** The content of a session tab: its status dot and protocol icon, then its title. */
function SessionTab({ session }: { session: Session }) {
  const { t } = useTranslation();
  const status = tabStatus(session.status);
  return (
    <>
      <StatusDot status={status} label={t(`status.${status}`)} />
      <ProtocolIcon protocol={session.kind} className="size-3.5" />
      <span className="truncate">{session.title}</span>
    </>
  );
}

/** Arrow keys / Home / End move the focus along the tab row (wraps around); Enter or Space opens the
 *  focused tab (TabFrame). It never activates on arrow press, so a focused tab keeps its focus. */
function moveBetweenTabs(event: React.KeyboardEvent<HTMLElement>): void {
  if (!(event.target instanceof HTMLElement)) return;
  const move = listMove(event.key, "horizontal");
  if (!move) return;
  const tabs = event.currentTarget.querySelectorAll<HTMLElement>("[role=tab]");
  const index = moveIndex(move, Array.from(tabs).indexOf(event.target), tabs.length, true);
  if (index < 0) return;
  event.preventDefault();
  tabs[index].focus();
}

export function TabBar() {
  const { t } = useTranslation();
  const sessions = useSessions((s) => s.sessions);
  const activeId = useSessions((s) => s.activeId);
  const settingsOpen = useSessions((s) => s.settingsOpen);
  const activate = useSessions((s) => s.activate);
  const requestClose = useSessions((s) => s.requestClose);

  return (
    <div
      role="tablist"
      aria-label={t("tabs.label")}
      onKeyDown={moveBetweenTabs}
      className="flex h-10 shrink-0 items-end gap-0.5 overflow-x-auto bg-sidebar px-2 select-none"
    >
      {sessions.map((session) => (
        <TabMenu key={session.id} session={session}>
          <TabFrame
            id={session.id}
            title={session.title}
            active={session.id === activeId}
            activate={activate}
            close={requestClose}
          >
            <SessionTab session={session} />
          </TabFrame>
        </TabMenu>
      ))}
      {settingsOpen && (
        <TabFrame
          id={SETTINGS_TAB}
          title={t("settings.title")}
          active={activeId === SETTINGS_TAB}
          activate={activate}
          close={requestClose}
          closeLabel={t("tabs.closeSettings")}
        >
          <Settings2 className="size-3.5" />
          <span className="truncate">{t("settings.title")}</span>
        </TabFrame>
      )}
      <IconButton
        variant="ghost"
        size="xs"
        label={t("tabs.new")}
        onClick={() => useUi.getState().openPalette("quickConnect")}
      >
        <Plus className="size-4" />
      </IconButton>
    </div>
  );
}
