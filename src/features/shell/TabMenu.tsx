// The right-click menu of a session tab: "Open in SFTP" (SSH tabs only), then "Close tab" (with the usual
// confirmation, via `requestClose`). The tab is the `asChild` trigger, so it keeps its click, middle-click and
// keyboard handling; the menu only adds the right-click. The Settings tab has no menu (TabBar does not wrap it).
import { FolderTree, X } from "lucide-react";
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
}

export function TabMenu({ session, children }: TabMenuProps) {
  const { t } = useTranslation();
  const requestClose = useSessions((s) => s.requestClose);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        {session.kind === "ssh" && (
          <>
            <ContextMenuItem onClick={() => openSftpFrom(session)}>
              <FolderTree className="size-3.5" />
              {t("tabMenu.openSftp")}
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem onClick={() => requestClose(session.id)}>
          <X className="size-3.5" />
          {t("tabMenu.close")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
