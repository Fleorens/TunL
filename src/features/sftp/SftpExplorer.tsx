// The SFTP tab: the toolbar on top, then the entries of the current folder. Mounts at the home directory,
// navigates by resolving a path on the server, and keeps only the outcome of the last navigation launched.
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { RemoteEntry } from "@/bindings/RemoteEntry";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Empty, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { notifyError } from "@/lib/errors";
import { pickFiles } from "@/lib/files";
import { ipc } from "@/lib/ipc";
import { DeleteEntryDialog } from "./DeleteEntryDialog";
import { EntryMenu } from "./EntryMenu";
import { EntryTable } from "./EntryTable";
import { NewFolderDialog } from "./NewFolderDialog";
import { PermissionsDialog } from "./PermissionsDialog";
import { SftpToolbar } from "./SftpToolbar";
import { DEFAULT_SORT, nextSort, parentPath, visibleEntries } from "./sftp-model";
import { TransfersPanel } from "./TransfersPanel";
import { useTransfers } from "./transfers-store";
import { type EntryActions, useEntryActions } from "./use-entry-actions";
import { useFileDrop } from "./use-file-drop";

interface SftpExplorerProps {
  sessionId: string;
  active: boolean;
}

/** The dialog open over the explorer, if any: a function, not a component, so it never remounts on a render. */
function dialogFor(actions: EntryActions) {
  const { dialog } = actions;
  if (dialog === null) return null;
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
          entry={dialog.entry}
          count={dialog.count}
          onConfirm={() => void actions.remove(dialog.entry)}
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
  }
}

export function SftpExplorer({ sessionId, active }: SftpExplorerProps) {
  const { t } = useTranslation();
  const [path, setPath] = useState("/");
  const [entries, setEntries] = useState<RemoteEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHidden, setShowHidden] = useState(false);
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  // The last navigation launched wins: a result older than this counter is dropped.
  const counter = useRef(0);
  // The folder shown right now, updated when a navigation succeeds (not when it starts), so an upload
  // that finishes only re-reads the folder it was dropped in if that folder is still shown.
  const shownPath = useRef("/");

  const navigate = useCallback(
    (target: string, select?: string): void => {
      counter.current += 1;
      const myId = counter.current;
      setLoading(true);
      ipc
        .sftpRealpath(sessionId, target)
        .then(async (resolved) => {
          const list = await ipc.sftpList(sessionId, resolved);
          if (myId !== counter.current) return;
          setPath(resolved);
          shownPath.current = resolved;
          setEntries(list);
          setSelectedPath(select ?? null);
        })
        .catch((error: unknown) => {
          // A newer navigation superseded this one: stay put, show nothing.
          if (myId !== counter.current) return;
          notifyError(error);
        })
        .finally(() => {
          if (myId === counter.current) setLoading(false);
        });
    },
    [sessionId],
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
        if (shownPath.current === target) navigate(target);
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

  // A link behaves like its target (T48): a link to a file downloads, a link to a folder navigates, a
  // broken link (no target) does nothing. A plain file downloads, a folder or an unknown entry navigates.
  const actions = useEntryActions(sessionId, path, (select) => navigate(path, select));
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
  const selectedEntry = entriesToShow.find((entry) => entry.path === selectedPath) ?? null;

  // A right click off a row empties the selection: the menu then offers "New folder" only.
  const onContextMenu = (event: React.MouseEvent): void => {
    const onRow = event.target instanceof Element && event.target.closest("tbody tr") !== null;
    if (!onRow) setSelectedPath(null);
  };

  return (
    <div className="relative flex h-full flex-col">
      <SftpToolbar
        path={path}
        showHidden={showHidden}
        onUp={() => navigate(parentPath(path))}
        onRefresh={() => navigate(path)}
        onNavigate={navigate}
        onToggleHidden={setShowHidden}
        onNewFolder={actions.newFolder}
        onUpload={onUpload}
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
                selectedPath={selectedPath}
                onSelect={setSelectedPath}
                onOpen={onOpen}
                onUp={() => navigate(parentPath(path))}
                renaming={actions.renaming}
                onRename={actions.rename}
                onRenameDone={(entry, name) => void actions.renamed(entry, name)}
                onDelete={(entry) => void actions.askDelete(entry)}
              />
            )}
          </div>
        </ContextMenuTrigger>
        <EntryMenu entry={selectedEntry} actions={actions} />
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
      {dialogFor(actions)}
    </div>
  );
}
