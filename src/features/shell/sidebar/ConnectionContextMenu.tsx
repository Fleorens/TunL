import {
  AtSign,
  Check,
  Copy,
  FolderTree,
  FolderUp,
  LogIn,
  Pencil,
  Power,
  Star,
  Trash2,
} from "lucide-react";
import type { ComponentProps, ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { Connection } from "@/bindings/Connection";
import type { Group } from "@/bindings/Group";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useConnections } from "@/features/connections/store";
import { wakeConnection } from "@/features/connections/wake";
import { openSession } from "@/features/sessions/open-session";
import { useUi } from "@/features/shell/ui-store";
import { copyText } from "@/lib/clipboard";

interface ConnectionContextMenuProps extends Omit<ComponentProps<typeof ContextMenu>, "children"> {
  connection: Connection;
  groups: readonly Group[];
  /** Select a connection by id (used to select the duplicate after a copy). */
  onSelectId: (id: string) => void;
  /** Open the confirm-delete dialog, raised in the parent. */
  onConfirmDelete: (connection: Connection) => void;
  children: ReactElement;
}

export function ConnectionContextMenu({
  connection,
  groups,
  onSelectId,
  onConfirmDelete,
  children,
}: ConnectionContextMenuProps) {
  const { t } = useTranslation();

  const duplicate = async () => {
    const copy = await useConnections.getState().duplicate(connection.id);
    if (copy) onSelectId(copy.id);
  };

  const setFavorite = async (favorite: boolean) => {
    await useConnections.getState().setFavorite(connection.id, favorite);
  };

  const moveToGroup = async (groupId: string | null) => {
    await useConnections.getState().moveToGroup(connection.id, groupId);
  };

  const copyAddress = async () => {
    const address = connection.username
      ? `${connection.username}@${connection.host}`
      : connection.host;
    await copyText(address);
  };

  const edit = () => useUi.getState().openEditor({ mode: "edit", id: connection.id });

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => openSession(connection)}>
          <LogIn className="size-3.5" />
          {t("connectionMenu.connect")}
        </ContextMenuItem>

        {connection.settings.protocol === "ssh" && (
          <ContextMenuItem onClick={() => openSession(connection, "sftp")}>
            <FolderTree className="size-3.5" />
            {t("connectionMenu.openSftp")}
          </ContextMenuItem>
        )}

        {connection.wol !== null && (
          <ContextMenuItem onClick={() => wakeConnection(connection)}>
            <Power className="size-3.5" />
            {t("connectionMenu.wake")}
          </ContextMenuItem>
        )}

        <ContextMenuSeparator />

        <ContextMenuItem onClick={edit}>
          <Pencil className="size-3.5" />
          {t("connectionMenu.edit")}
        </ContextMenuItem>

        <ContextMenuItem onClick={duplicate}>
          <Copy className="size-3.5" />
          {t("connectionMenu.duplicate")}
        </ContextMenuItem>

        <ContextMenuItem onClick={() => setFavorite(!connection.favorite)}>
          <Star className="size-3.5" fill={connection.favorite ? "currentColor" : "none"} />
          {connection.favorite
            ? t("connectionMenu.removeFavorite")
            : t("connectionMenu.addFavorite")}
        </ContextMenuItem>

        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <FolderUp className="size-3.5" />
            {t("connectionMenu.moveToGroup")}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {groups.map((group) => (
              <ContextMenuItem key={group.id} onClick={() => moveToGroup(group.id)}>
                {connection.groupId === group.id && <Check className="size-3.5" />}
                {group.name}
              </ContextMenuItem>
            ))}
            <ContextMenuSeparator />
            <ContextMenuItem
              onClick={() => moveToGroup(null)}
              disabled={connection.groupId === null}
            >
              {t("sidebar.noGroup")}
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuItem onClick={copyAddress}>
          <AtSign className="size-3.5" />
          {t("connectionMenu.copyAddress")}
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem variant="destructive" onClick={() => onConfirmDelete(connection)}>
          <Trash2 className="size-3.5" />
          {t("connectionMenu.delete")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
