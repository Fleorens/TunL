// The SFTP tab: the toolbar on top, then the entries of the current folder. Mounts at the home directory,
// navigates by resolving a path on the server, and keeps only the outcome of the last navigation launched.
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { RemoteEntry } from "@/bindings/RemoteEntry";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Empty, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { openTerminalFrom } from "@/features/sessions/open-session";
import { useSessions } from "@/features/sessions/store";
import { notifyError } from "@/lib/errors";
import { pickFiles, pickFolder } from "@/lib/files";
import { ipc } from "@/lib/ipc";
import { DeleteEntryDialog } from "./DeleteEntryDialog";
import { EditConflictDialog } from "./EditConflictDialog";
import { EntryMenu } from "./EntryMenu";
import { EntryTable } from "./EntryTable";
import { useEdits } from "./edits-store";
import { NewFolderDialog } from "./NewFolderDialog";
import { PermissionsDialog } from "./PermissionsDialog";
import { SftpToolbar } from "./SftpToolbar";
import { EMPTY_SELECTION, keepVisible, type Selection, selectOne } from "./selection-model";
import {
  DEFAULT_SORT,
  formatSize,
  isDownloadable,
  nextSort,
  parentPath,
  visibleEntries,
} from "./sftp-model";
import { TransfersPanel } from "./TransfersPanel";
import { useTransfers } from "./transfers-store";
import { type EntryActions, useEntryActions } from "./use-entry-actions";
import { useFileDrop } from "./use-file-drop";

interface SftpExplorerProps {
  sessionId: string;
  active: boolean;
}

/** The dialog open over the explorer, if any: a hook, so it can translate; rendered inline, so it never remounts. */
function useDialogFor(actions: EntryActions) {
  const { t, i18n } = useTranslation();
  const { dialog } = actions;
  if (dialog === null) return null;
  const locale = i18n.language;
  switch (dialog.type) {
    case "newFolder":
      return (
        <NewFolderDialog
          onCreate={(name) => void actions.createFolder(name)}
          onCancel={actions.closeDialog}
        />
      );
    case "delete":
      return (
        <DeleteEntryDialog
          entries={dialog.entries}
          count={dialog.count}
          onConfirm={() => void actions.removeMany(dialog.entries)}
          onCancel={actions.closeDialog}
        />
      );
    case "permissions":
      return (
        <PermissionsDialog
          entry={dialog.entry}
          onApply={(mode) => void actions.chmod(dialog.entry, mode)}
          onCancel={actions.closeDialog}
        />
      );
    case "editLarge":
      return (
        <AlertDialog open onOpenChange={(open) => !open && actions.closeDialog()}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("sftp.edit.bigTitle")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("sftp.edit.big", {
                  name: dialog.entry.name,
                  size: formatSize(dialog.entry.size, locale),
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={actions.openLarge}>
                {t("sftp.edit.open")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      );
  }
}

// Read one folder once, resolving its path first.
function readFolder(
  sessionId: string,
  target: string,
): Promise<{ resolved: string; list: RemoteEntry[] }> {
  return ipc
    .sftpRealpath(sessionId, target)
    .then(async (resolved) => ({ resolved, list: await ipc.sftpList(sessionId, resolved) }));
}

/** How a read folder sets the selection: from the entries read and the selection before. */
type NextSelection = (list: RemoteEntry[], prev: Selection) => Selection;

export function SftpExplorer({ sessionId, active }: SftpExplorerProps) {
  const { t } = useTranslation();
  const [path, setPath] = useState("/");
  const [entries, setEntries] = useState<RemoteEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHidden, setShowHidden] = useState(false);
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  // The last navigation launched wins: a result older than this counter is dropped.
  const counter = useRef(0);
  // The folder shown right now, updated when a navigation succeeds (not when it starts), so an upload
  // that finishes only re-reads the folder it was dropped in if that folder is still shown.
  const shownPath = useRef("/");

  // Show `target` once read, the selection set by `next`. The last read launched wins: an older one, superseded
  // by the counter, drops its result.
  const load = useCallback(
    (target: string, next: NextSelection): void => {
      const myId = ++counter.current;
      setLoading(true);
      readFolder(sessionId, target)
        .then(({ resolved, list }) => {
          if (myId !== counter.current) return;
          setPath(resolved);
          shownPath.current = resolved;
          setEntries(list);
          setSelection((prev) => next(list, prev));
        })
        .catch((error: unknown) => {
          if (myId !== counter.current) return;
          notifyError(error);
        })
        .finally(() => {
          if (myId === counter.current) setLoading(false);
        });
    },
    [sessionId],
  );

  // A change of folder empties the selection; `navigate(target, select)` selects `select` instead.
  const navigate = useCallback(
    (target: string, select?: string): void =>
      load(target, () => (select ? selectOne(select) : EMPTY_SELECTION)),
    [load],
  );

  // Re-read a folder: the selection keeps only what is still shown (a refresh, not a change of folder).
  const reload = useCallback(
    (target: string): void =>
      load(target, (list, prev) =>
        keepVisible(
          prev,
          visibleEntries(list, sort, showHidden).map((entry) => entry.path),
        ),
      ),
    [load, sort, showHidden],
  );

  useEffect(() => {
    navigate(".");
  }, [navigate]);

  // Upload each chosen file to the folder shown, then re-read it when one finishes — but only if that
  // folder is still the one shown (the ref is kept up to date by `navigate`, not the value captured here).
  const uploadAll = (paths: string[]): void => {
    const target = shownPath.current;
    for (const localPath of paths) {
      useTransfers.getState().upload(sessionId, localPath, target, () => {
        if (shownPath.current === target) reload(target);
      });
    }
  };

  // The files dragged onto the tab: the window handler for Tauri, the HTML5 handlers for the mock.
  const { dragging, dropProps } = useFileDrop(active, uploadAll);

  // The toolbar's "Upload files": choose, then upload what was chosen, surfacing a failure as a toast.
  const onUpload = (): void => {
    pickFiles()
      .then((paths) => uploadAll(paths))
      .catch(notifyError);
  };

  // The toolbar's "Open a terminal here": a shell on the same target, already `cd`-ed into the folder shown.
  const session = useSessions((s) => s.sessions.find((x) => x.id === sessionId));
  const onOpenTerminal = (): void => {
    if (session) openTerminalFrom(session, path);
  };

  // The toolbar's "Upload a folder": choose one, then upload it whole, surfacing a failure as a toast.
  const onUploadFolder = (): void => {
    pickFolder()
      .then((path) => (path ? uploadAll([path]) : undefined))
      .catch(notifyError);
  };

  // A link behaves like its target (T48): a link to a file downloads, a link to a folder navigates, a
  // broken link (no target) does nothing. A plain file downloads, a folder or an unknown entry navigates.
  const actions = useEntryActions(sessionId, path, (select) => navigate(path, select));
  // The first edit in conflict on this tab, so the dialog mounts once and unmounts when it resolves or closes.
  const conflict = useEdits((s) => {
    for (const e of Object.values(s.edits)) {
      if (e.sessionId === sessionId && e.status === "conflict") return e;
    }
    return null;
  });
  const onOpen = (entry: RemoteEntry): void => {
    if (entry.kind === "symlink") {
      if (entry.targetKind === "file") actions.download(entry);
      else if (entry.targetKind !== undefined) navigate(entry.path);
      return;
    }
    if (entry.kind === "file" || entry.kind === "other") {
      actions.download(entry);
      return;
    }
    navigate(entry.path);
  };

  const entriesToShow = visibleEntries(entries, sort, showHidden);
  const focusEntry = entriesToShow.find((entry) => entry.path === selection.focus) ?? null;
  // The selected entries, in the shown order; only the downloadable ones are downloaded at once.
  const selectedEntries = selection.paths
    .map((path) => entriesToShow.find((entry) => entry.path === path))
    .filter((entry): entry is RemoteEntry => entry !== undefined);
  const downloadableEntries = selectedEntries.filter(isDownloadable);

  // A right click off a row empties the selection: the menu then offers "New folder" only.
  const onContextMenu = (event: React.MouseEvent): void => {
    const onRow = event.target instanceof Element && event.target.closest("tbody tr") !== null;
    if (!onRow) setSelection(EMPTY_SELECTION);
  };

  // A right click on a row selects it alone, unless it is already in the selection, which the menu keeps; the
  // cursor moves onto it either way, since a one-row menu acts on the cursor.
  const onSelectOnRightClick = (path: string): void => {
    setSelection((prev) => {
      if (!prev.paths.includes(path)) return selectOne(path);
      return prev.focus === path ? prev : { ...prev, focus: path };
    });
  };

  // A refresh keeps what is still shown; hiding or showing hidden files keeps the selection too.
  const onToggleHidden = (): void => {
    const next = !showHidden;
    const order = visibleEntries(entries, sort, next).map((entry) => entry.path);
    setShowHidden(next);
    setSelection((prev) => keepVisible(prev, order));
  };

  return (
    <div className="relative flex h-full flex-col">
      <SftpToolbar
        path={path}
        showHidden={showHidden}
        onUp={() => navigate(parentPath(path))}
        onRefresh={() => reload(path)}
        onNavigate={navigate}
        onToggleHidden={onToggleHidden}
        onNewFolder={actions.newFolder}
        onUpload={onUpload}
        onUploadFolder={onUploadFolder}
        onOpenTerminal={onOpenTerminal}
        busy={actions.busy}
      />
      <ContextMenu modal={false}>
        <ContextMenuTrigger asChild onContextMenu={onContextMenu} {...dropProps}>
          <div className="min-h-0 flex-1">
            {loading && entries.length === 0 ? (
              <div className="flex h-full w-full items-center justify-center">
                <Spinner />
              </div>
            ) : entriesToShow.length === 0 ? (
              <Empty>
                <EmptyTitle>{t("sftp.empty")}</EmptyTitle>
              </Empty>
            ) : (
              <EntryTable
                entries={entriesToShow}
                sort={sort}
                onSort={(key) => setSort(nextSort(sort, key))}
                selection={selection}
                onSelectionChange={setSelection}
                onSelectionOnRightClick={onSelectOnRightClick}
                onOpen={onOpen}
                onUp={() => navigate(parentPath(path))}
                renaming={actions.renaming}
                onRename={actions.rename}
                onRenameDone={(entry, name) => void actions.renamed(entry, name)}
                onDelete={(entry) => void actions.askDelete(entry)}
                onDeleteMany={() => void actions.askDeleteMany(selectedEntries)}
              />
            )}
          </div>
        </ContextMenuTrigger>
        <EntryMenu
          entry={focusEntry}
          deleteCount={selectedEntries.length}
          hasMany={selectedEntries.length > 1}
          downloadableCount={downloadableEntries.length}
          onDownloadMany={() => actions.downloadMany(downloadableEntries)}
          onDeleteMany={() => actions.askDeleteMany(selectedEntries)}
          actions={actions}
        />
      </ContextMenu>
      {dragging && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute inset-2 top-13 z-20 flex items-center justify-center border-2 border-dashed border-primary bg-primary/5"
        >
          <div className="rounded-lg bg-background shadow-elevated px-6 py-3 text-sm font-medium">
            {t("sftp.dropHere", { path })}
          </div>
        </div>
      )}
      <TransfersPanel sessionId={sessionId} />
      {useDialogFor(actions)}
      {conflict && (
        <EditConflictDialog
          name={conflict.name}
          onKeep={() => void useEdits.getState().resolve(conflict.id, false)}
          onReplace={() => void useEdits.getState().resolve(conflict.id, true)}
        />
      )}
    </div>
  );
}
