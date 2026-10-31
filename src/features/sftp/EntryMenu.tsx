// The explorer's context menu: the actions on one entry, or only "New folder" on the empty area; when several rows
// are selected, the batch actions instead (docs/04 §6).
import { ClipboardCopy, Download, FolderPlus, Pencil, ShieldCheck, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { RemoteEntry } from "@/bindings/RemoteEntry";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from "@/components/ui/context-menu";
import { isDownloadable } from "./sftp-model";
import type { EntryActions } from "./use-entry-actions";

interface EntryMenuProps {
  /** The right-clicked entry, or `null` on the empty area. */
  entry: RemoteEntry | null;
  /** How many selected rows "Delete N items…" removes. */
  deleteCount: number;
  /** Several rows are selected: offer the batch actions instead of the per-entry ones. */
  hasMany: boolean;
  /** The selected rows that can be downloaded (zero or more). */
  downloadableCount: number;
  /** Download every selectable row at once. */
  onDownloadMany: () => void;
  /** Delete every selected row at once. */
  onDeleteMany: () => void;
  actions: EntryActions;
}

export function EntryMenu({
  entry,
  deleteCount,
  hasMany,
  downloadableCount,
  onDownloadMany,
  onDeleteMany,
  actions,
}: EntryMenuProps) {
  const { t } = useTranslation();
  return (
    // No focus back to the trigger on close: the rename field must keep it (see the T25b traps).
    <ContextMenuContent className="w-52" onCloseAutoFocus={(event) => event.preventDefault()}>
      {hasMany ? (
        <>
          {downloadableCount > 0 && (
            <ContextMenuItem onSelect={onDownloadMany}>
              <Download />
              {t("sftp.menu.downloadMany", { count: downloadableCount })}
            </ContextMenuItem>
          )}
          <ContextMenuItem onSelect={actions.newFolder}>
            <FolderPlus />
            {t("sftp.menu.newFolder")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={onDeleteMany}>
            <Trash2 />
            {t("sftp.menu.deleteMany", { count: deleteCount })}
            <ContextMenuShortcut aria-hidden>Del</ContextMenuShortcut>
          </ContextMenuItem>
        </>
      ) : (
        <>
          {/* A folder or a link to a folder opens in the explorer instead (T48). */}
          {entry !== null && isDownloadable(entry) && (
            <ContextMenuItem onSelect={() => actions.download(entry)}>
              <Download />
              {t("sftp.menu.download")}
            </ContextMenuItem>
          )}
          {entry && (
            <>
              <ContextMenuItem onSelect={() => actions.rename(entry)}>
                <Pencil />
                {t("sftp.menu.rename")}
                <ContextMenuShortcut aria-hidden>F2</ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => void actions.copyPath(entry)}>
                <ClipboardCopy />
                {t("sftp.menu.copyPath")}
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => actions.permissions(entry)}>
                <ShieldCheck />
                {t("sftp.menu.permissions")}
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuItem onSelect={actions.newFolder}>
            <FolderPlus />
            {t("sftp.menu.newFolder")}
          </ContextMenuItem>
          {entry && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive" onSelect={() => void actions.askDelete(entry)}>
                <Trash2 />
                {t("sftp.menu.delete")}
                <ContextMenuShortcut aria-hidden>Del</ContextMenuShortcut>
              </ContextMenuItem>
            </>
          )}
        </>
      )}
    </ContextMenuContent>
  );
}
