// The explorer's actions on one entry: new folder, rename in place, copy the path, permissions, delete.
// The open dialog and the entry being renamed live here; every `ipc` call shows a translated toast on failure.
import { useRef, useState } from "react";
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
  // True from the start of a delete's counting to its end (or its cancel, or an error): while it is,
  // the delete / new folder / rename actions are ignored and the toolbar shows it is working.
  const [busy, setBusy] = useState(false);
  // True while the delete confirmation is open and unanswered. Radix closes it right after its confirm button runs
  // `remove`, and closing another dialog can happen mid-delete: neither may end the busy window, only a cancel.
  const confirming = useRef(false);

  const closeDialog = (): void => {
    setDialog(null);
    if (!confirming.current) return;
    confirming.current = false;
    setBusy(false);
  };

  const newFolder = (): void => {
    if (busy) return;
    setDialog({ type: "newFolder" });
  };

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

  const rename = (entry: RemoteEntry): void => {
    if (busy) return;
    setRenaming(entry.path);
  };

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
    void useTransfers.getState().download(sessionId, entry);
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
    if (busy) return;
    setBusy(true);
    try {
      const count = await ipc.sftpCount(sessionId, entry.path);
      confirming.current = true;
      setDialog({ type: "delete", entry, count });
    } catch (error) {
      setBusy(false);
      notifyError(error);
    }
  };

  const remove = async (entry: RemoteEntry): Promise<void> => {
    confirming.current = false;
    setDialog(null);
    try {
      await ipc.sftpRemove(sessionId, entry.path);
      reload();
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  };

  return {
    dialog,
    busy,
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
