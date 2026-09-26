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
import { toast } from "sonner";
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

  const soon = () => toast("shell.notYetAvailable");

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={soon}>
          <LogIn className="size-3.5" />
          {t("connectionMenu.connect")}
        </ContextMenuItem>

        {connection.protocol === "ssh" && (
          <ContextMenuItem onClick={soon}>
            <FolderTree className="size-3.5" />
            {t("connectionMenu.openSftp")}
          </ContextMenuItem>
        )}

        {connection.tags.includes("wol") && (
          <ContextMenuItem onClick={soon}>
            <Power className="size-3.5" />
            {t("connectionMenu.wake")}
          </ContextMenuItem>
        )}

        <ContextMenuSeparator />

        <ContextMenuItem onClick={soon}>
          <Pencil className="size-3.5" />
          {t("connectionMenu.edit")}
        </ContextMenuItem>
        <ContextMenuItem onClick={soon}>
          <Copy className="size-3.5" />
          {t("connectionMenu.duplicate")}
        </ContextMenuItem>

        <ContextMenuCheckboxItem checked={connection.favorite} onClick={soon}>
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
              <ContextMenuItem key={group.id} onClick={soon}>
                {group.name}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuItem onClick={soon}>
          <AtSign className="size-3.5" />
          {t("connectionMenu.copyAddress")}
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem variant="destructive" onClick={soon}>
          <Trash2 className="size-3.5" />
          {t("connectionMenu.delete")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
