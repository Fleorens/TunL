import {
  AtSign,
  Copy,
  FolderTree,
  FolderUp,
  LogIn,
  Pencil,
  Power,
  Star,
  Trash2,
} from "lucide-react";
import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { notifyComingSoon } from "@/features/shell/coming-soon";
import type { DemoConnection, DemoGroup } from "@/features/shell/demo-data";

interface ConnectionContextMenuProps {
  connection: DemoConnection;
  groups: readonly DemoGroup[];
  children: ReactElement;
}

export function ConnectionContextMenu({
  connection,
  groups,
  children,
}: ConnectionContextMenuProps) {
  const { t } = useTranslation();

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={notifyComingSoon}>
          <LogIn className="size-3.5" />
          {t("connectionMenu.connect")}
        </ContextMenuItem>

        {connection.protocol === "ssh" && (
          <ContextMenuItem onClick={notifyComingSoon}>
            <FolderTree className="size-3.5" />
            {t("connectionMenu.openSftp")}
          </ContextMenuItem>
        )}

        {connection.tags.includes("wol") && (
          <ContextMenuItem onClick={notifyComingSoon}>
            <Power className="size-3.5" />
            {t("connectionMenu.wake")}
          </ContextMenuItem>
        )}

        <ContextMenuSeparator />

        <ContextMenuItem onClick={notifyComingSoon}>
          <Pencil className="size-3.5" />
          {t("connectionMenu.edit")}
        </ContextMenuItem>
        <ContextMenuItem onClick={notifyComingSoon}>
          <Copy className="size-3.5" />
          {t("connectionMenu.duplicate")}
        </ContextMenuItem>

        <ContextMenuCheckboxItem checked={connection.favorite} onClick={notifyComingSoon}>
          <Star className="size-3.5" fill={connection.favorite ? "currentColor" : "none"} />
          {connection.favorite
            ? t("connectionMenu.removeFavorite")
            : t("connectionMenu.addFavorite")}
        </ContextMenuCheckboxItem>

        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <FolderUp className="size-3.5" />
            {t("connectionMenu.moveToGroup")}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {groups.map((group) => (
              <ContextMenuItem key={group.id} onClick={notifyComingSoon}>
                {group.name}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuItem onClick={notifyComingSoon}>
          <AtSign className="size-3.5" />
          {t("connectionMenu.copyAddress")}
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem variant="destructive" onClick={notifyComingSoon}>
          <Trash2 className="size-3.5" />
          {t("connectionMenu.delete")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
