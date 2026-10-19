// The explorer's actions on one entry: new folder, rename in place, copy the path, permissions, delete.
// The open dialog and the entry being renamed live here; every `ipc` call shows a translated toast on failure.
import { useState } from "react";
import { toast } from "sonner";
import type { RemoteEntry } from "@/bindings/RemoteEntry";
import { i18n } from "@/i18n";
import { copyText } from "@/lib/clipboard";
import { notifyError } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import { isValidName, joinPath } from "./sftp-model";
import { useTransfers } from "./transfers-store";

/** The dialog open over the explorer, if any. */
export type EntryDialog =
  | { type: "newFolder" }
  | { type: "delete"; entry: RemoteEntry; count: number }
  | { type: "permissions"; entry: RemoteEntry }
  | null;

export type EntryActions = ReturnType<typeof useEntryActions>;

/** `reload(select?)` reads the current folder again and selects `select` (a full path) when given. */
export function useEntryActions(sessionId: string, dir: string, reload: (select?: string) => void) {
  const [dialog, setDialog] = useState<EntryDialog>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  const closeDialog = (): void => setDialog(null);

  const newFolder = (): void => setDialog({ type: "newFolder" });

  const createFolder = async (name: string): Promise<void> => {
    setDialog(null);
    const path = joinPath(dir, name);
    try {
      await ipc.sftpMkdir(sessionId, path);
      reload(path);
    } catch (error) {
      notifyError(error);
    }
  };

  const rename = (entry: RemoteEntry): void => setRenaming(entry.path);

  const renamed = async (entry: RemoteEntry, name: string | null): Promise<void> => {
    setRenaming(null);
    if (name === null || name === entry.name) return;
    if (!isValidName(name)) {
      toast.error(i18n.t("sftp.invalidName"));
      return;
    }
    const target = joinPath(dir, name);
    try {
      await ipc.sftpRename(sessionId, entry.path, target);
      reload(target);
    } catch (error) {
      notifyError(error);
    }
  };

  const copyPath = async (entry: RemoteEntry): Promise<void> => {
    await copyText(entry.path);
  };

  // A download runs in the background (its events come back through the store's channel); the menu never rerenders
  // on progress, so it reads the store directly instead of subscribing.
  const download = (entry: RemoteEntry): void => {
    useTransfers.getState().download(sessionId, entry);
  };

  const permissions = (entry: RemoteEntry): void => setDialog({ type: "permissions", entry });

  const chmod = async (entry: RemoteEntry, mode: number): Promise<void> => {
    setDialog(null);
    try {
      await ipc.sftpChmod(sessionId, entry.path, mode);
      reload(entry.path);
    } catch (error) {
      notifyError(error);
    }
  };

  // The server counts what would go before the confirmation opens: never a delete without the number (S11).
  const askDelete = async (entry: RemoteEntry): Promise<void> => {
    try {
      const count = await ipc.sftpCount(sessionId, entry.path);
      setDialog({ type: "delete", entry, count });
    } catch (error) {
      notifyError(error);
    }
  };

  const remove = async (entry: RemoteEntry): Promise<void> => {
    setDialog(null);
    try {
      await ipc.sftpRemove(sessionId, entry.path);
      reload();
    } catch (error) {
      notifyError(error);
    }
  };

  return {
    dialog,
    renaming,
    closeDialog,
    newFolder,
    createFolder,
    rename,
    renamed,
    copyPath,
    permissions,
    chmod,
    askDelete,
    remove,
    download,
  };
}
