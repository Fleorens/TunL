// The SFTP tab: the toolbar on top, then the entries of the current folder. Mounts at the home directory,
// navigates by resolving a path on the server, and keeps only the outcome of the last navigation launched.
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { RemoteEntry } from "@/bindings/RemoteEntry";
import { Empty, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { notifyError } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import { EntryTable } from "./EntryTable";
import { SftpToolbar } from "./SftpToolbar";
import { DEFAULT_SORT, nextSort, parentPath, visibleEntries } from "./sftp-model";

interface SftpExplorerProps {
  sessionId: string;
}

export function SftpExplorer({ sessionId }: SftpExplorerProps) {
  const { t } = useTranslation();
  const [path, setPath] = useState("/");
  const [entries, setEntries] = useState<RemoteEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHidden, setShowHidden] = useState(false);
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  // The last navigation launched wins: a result older than this counter is dropped.
  const counter = useRef(0);

  const navigate = useCallback(
    (target: string): void => {
      counter.current += 1;
      const myId = counter.current;
      setLoading(true);
      ipc
        .sftpRealpath(sessionId, target)
        .then(async (resolved) => {
          const list = await ipc.sftpList(sessionId, resolved);
          if (myId !== counter.current) return;
          setPath(resolved);
          setEntries(list);
          setSelectedPath(null);
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

  // A folder or a link goes in (the server follows the link); a file does nothing until T26.
  const onOpen = (entry: RemoteEntry): void => {
    if (entry.kind === "file") return;
    navigate(entry.path);
  };

  const entriesToShow = visibleEntries(entries, sort, showHidden);

  return (
    <>
      <SftpToolbar
        path={path}
        showHidden={showHidden}
        onUp={() => navigate(parentPath(path))}
        onRefresh={() => navigate(path)}
        onNavigate={navigate}
        onEnterPath={navigate}
        onToggleHidden={setShowHidden}
      />
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
          />
        )}
      </div>
    </>
  );
}
