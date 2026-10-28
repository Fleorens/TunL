// The explorer's context menu: the actions on one entry, or only "New folder" on the empty area (docs/04 §6).
import { ClipboardCopy, Download, FolderPlus, Pencil, ShieldCheck, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { RemoteEntry } from "@/bindings/RemoteEntry";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from "@/components/ui/context-menu";
import type { EntryActions } from "./use-entry-actions";

interface EntryMenuProps {
  /** The entry right-clicked, or `null` on the empty area. */
  entry: RemoteEntry | null;
  actions: EntryActions;
}

export function EntryMenu({ entry, actions }: EntryMenuProps) {
  const { t } = useTranslation();
  // A download is offered on a file (or an unknown entry), on a link to a file (T48), never on a folder or
  // a link to a folder: those open in the explorer.
  const downloadable =
    entry?.kind === "file" ||
    entry?.kind === "other" ||
    (entry?.kind === "symlink" && entry.targetKind === "file");
  return (
    // No focus back to the trigger on close: the rename field must keep it (see the T25b traps).
    <ContextMenuContent className="w-52" onCloseAutoFocus={(event) => event.preventDefault()}>
      {downloadable && (
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
    </ContextMenuContent>
  );
}
