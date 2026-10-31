// The right-click menu of a session tab: Duplicate, "Open in SFTP" (SSH tabs only), then "Close tab",
// "Close other tabs", "Close tabs to the right". The tab is the `asChild` trigger, so it keeps its click,
// middle-click and keyboard handling; the menu only adds the right-click. The Settings tab has no menu.
import { ArrowRightToLine, Copy, FolderTree, ListX, X } from "lucide-react";
import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { openSftpFrom } from "@/features/sessions/open-session";
import type { Session } from "@/features/sessions/session-model";
import { useSessions } from "@/features/sessions/store";

interface TabMenuProps {
  session: Session;
  children: ReactElement;
  /** The session tab is the last one, so "Close tabs to the right" has nothing to close. */
  lastSession: boolean;
}

export function TabMenu({ session, children, lastSession }: TabMenuProps) {
  const { t } = useTranslation();
  const duplicate = useSessions((s) => s.duplicate);
  const requestClose = useSessions((s) => s.requestClose);
  const closeOthers = useSessions((s) => s.closeOthers);
  const closeRight = useSessions((s) => s.closeRight);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => duplicate(session.id)}>
          <Copy className="size-3.5" />
          {t("tabMenu.duplicate")}
        </ContextMenuItem>
        {session.kind === "ssh" && (
          <ContextMenuItem onClick={() => openSftpFrom(session)}>
            <FolderTree className="size-3.5" />
            {t("tabMenu.openSftp")}
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => requestClose(session.id)}>
          <X className="size-3.5" />
          {t("tabMenu.close")}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => closeOthers(session.id)}>
          <ListX className="size-3.5" />
          {t("tabMenu.closeOthers")}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => closeRight(session.id)} disabled={lastSession}>
          <ArrowRightToLine className="size-3.5" />
          {t("tabMenu.closeRight")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
