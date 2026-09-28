import { FolderPlus, Import, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AccentColor } from "@/bindings/AccentColor";
import type { Connection } from "@/bindings/Connection";
import type { Group } from "@/bindings/Group";
import { SectionHeader } from "@/components/SectionHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { filterConnections } from "@/features/connections/filter";
import { openImport } from "@/features/connections/open-import";
import { buildSidebarSections, compareNames } from "@/features/connections/sections";
import { useConnections } from "@/features/connections/store";
import { notifyComingSoon } from "@/features/shell/coming-soon";
import { ConfirmDelete } from "@/features/shell/sidebar/ConfirmDelete";
import { ConnectionContextMenu } from "@/features/shell/sidebar/ConnectionContextMenu";
import { ConnectionRow } from "@/features/shell/sidebar/ConnectionRow";
import { GroupDialog } from "@/features/shell/sidebar/GroupDialog";
import { GroupSection } from "@/features/shell/sidebar/GroupSection";

interface PendingDialog {
  mode: "create" | "rename";
  id: string | null;
  name: string;
  color: AccentColor | null;
}

// Placeholder rows shown while the store is idle or loading. Defined as values (not
// the map index) so the skeleton list has stable keys without linting the index.
const SKELETON_KEYS = [0, 1, 2, 3, 4, 5];

export function Sidebar() {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [groupDialog, setGroupDialog] = useState<PendingDialog | null>(null);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{
    kind: "connection" | "group";
    id: string;
    name: string;
  } | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  // Raw data only, then derive: a selector that builds an array would loop forever in React 19.
  const groups = useConnections((state) => state.groups);
  const connections = useConnections((state) => state.connections);
  const status = useConnections((state) => state.status);
  const loadError = useConnections((state) => state.loadError);

  const sections = useMemo(() => buildSidebarSections(connections, groups), [connections, groups]);

  const results = useMemo(() => {
    if (query.trim() === "") return null;
    return filterConnections(connections, query).toSorted((a, b) => compareNames(a.name, b.name));
  }, [connections, query]);

  // Map each connection to the name of its jump host, for the row indicator.
  const jumpHostNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const connection of connections) {
      if (connection.jumpHostId) {
        const host = connections.find((candidate) => candidate.id === connection.jumpHostId);
        if (host) map.set(connection.id, host.name);
      }
    }
    return map;
  }, [connections]);

  const openCreateGroup = () => {
    setGroupDialog({ mode: "create", id: null, name: "", color: null });
    setGroupDialogOpen(true);
  };

  const openRenameGroup = (group: Group) => {
    setGroupDialog({ mode: "rename", id: group.id, name: group.name, color: group.color });
    // Menu → dialog focus conflict: open on the next tick so the menu closes first.
    setTimeout(() => setGroupDialogOpen(true), 0);
  };

  const closeGroupDialog = () => {
    setGroupDialog(null);
    setGroupDialogOpen(false);
  };

  const openConfirmDelete = (connection: Connection) => {
    setConfirmDelete({ kind: "connection", id: connection.id, name: connection.name });
    // Same focus conflict as above.
    setTimeout(() => setConfirmDeleteOpen(true), 0);
  };

  const openConfirmDeleteGroup = (group: Group) => {
    setConfirmDelete({ kind: "group", id: group.id, name: group.name });
    // Same focus conflict as above.
    setTimeout(() => setConfirmDeleteOpen(true), 0);
  };

  const closeConfirmDelete = () => {
    setConfirmDelete(null);
    setConfirmDeleteOpen(false);
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    if (confirmDelete.kind === "group") {
      await useConnections.getState().removeGroup(confirmDelete.id);
    } else {
      await useConnections.getState().remove(confirmDelete.id);
    }
  };

  const newGroupAction =
    groups.length === 0 ? (
      <Button variant="link" size="sm" className="justify-end" onClick={openCreateGroup}>
        {t("sidebar.createGroup")}
      </Button>
    ) : (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("sidebar.newGroup")}
            onClick={openCreateGroup}
          >
            <FolderPlus className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("sidebar.newGroup")}</TooltipContent>
      </Tooltip>
    );

  return (
    <aside className="flex w-full flex-col gap-2 border-r bg-sidebar">
      <div className="flex items-center gap-2 px-2 pt-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-subtle-foreground" />
          <Input
            id="sidebar-filter"
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("sidebar.filterPlaceholder")}
            aria-label={t("sidebar.filterPlaceholder")}
            className="h-8 bg-muted pl-8 pr-2"
          />
        </div>
      </div>

      <ScrollArea className="flex-1 px-2 pb-2">
        {status === "idle" || status === "loading" ? (
          <div className="flex flex-col gap-0.5">
            {SKELETON_KEYS.map((key) => (
              <Skeleton key={key} className="h-8 w-full" />
            ))}
          </div>
        ) : status === "error" ? (
          <div className="flex flex-col gap-2 p-2">
            <h2 className="text-sm font-medium">{t("sidebar.loadError")}</h2>
            <p className="text-xs text-muted-foreground">{loadError?.message}</p>
            <Button variant="outline" onClick={() => useConnections.getState().load()}>
              {t("common.retry")}
            </Button>
          </div>
        ) : results !== null ? (
          <section aria-label={t("sidebar.results")}>
            <SectionHeader title={t("sidebar.results")} />
            {results.length === 0 ? (
              <p className="px-2 py-4 text-xs text-muted-foreground">
                {t("sidebar.noResults", { query })}
              </p>
            ) : (
              <ConnectionsList
                connections={results}
                selectedId={selectedId}
                onSelectId={setSelectedId}
                onConfirmDelete={openConfirmDelete}
                jumpHostNames={jumpHostNames}
              />
            )}
          </section>
        ) : (
          <div className="flex flex-col gap-3">
            {sections.favorites.length > 0 && (
              <section aria-label={t("sidebar.favorites")}>
                <SectionHeader title={t("sidebar.favorites")} />
                <ConnectionsList
                  connections={sections.favorites}
                  selectedId={selectedId}
                  onSelectId={setSelectedId}
                  onConfirmDelete={openConfirmDelete}
                  jumpHostNames={jumpHostNames}
                />
              </section>
            )}

            {sections.recents.length > 0 && (
              <section aria-label={t("sidebar.recents")}>
                <SectionHeader title={t("sidebar.recents")} />
                <ConnectionsList
                  connections={sections.recents}
                  selectedId={selectedId}
                  onSelectId={setSelectedId}
                  onConfirmDelete={openConfirmDelete}
                  jumpHostNames={jumpHostNames}
                />
              </section>
            )}

            <SectionHeader title={t("sidebar.groups")} action={newGroupAction} />

            {sections.groups.map((section, index) => (
              <section key={section.group.id} aria-label={section.group.name}>
                <GroupSection
                  group={section.group}
                  index={index}
                  groupCount={sections.groups.length}
                  count={section.connections.length}
                  onRename={() => openRenameGroup(section.group)}
                  onMoveUp={() => useConnections.getState().moveGroup(section.group.id, -1)}
                  onMoveDown={() => useConnections.getState().moveGroup(section.group.id, 1)}
                  onDelete={() => openConfirmDeleteGroup(section.group)}
                >
                  <ConnectionsList
                    connections={section.connections}
                    selectedId={selectedId}
                    onSelectId={setSelectedId}
                    onConfirmDelete={openConfirmDelete}
                    jumpHostNames={jumpHostNames}
                  />
                </GroupSection>
              </section>
            ))}

            {sections.ungrouped.length > 0 && (
              <section aria-label={t("sidebar.ungrouped")}>
                <SectionHeader title={t("sidebar.ungrouped")} />
                <ConnectionsList
                  connections={sections.ungrouped}
                  selectedId={selectedId}
                  onSelectId={setSelectedId}
                  onConfirmDelete={openConfirmDelete}
                  jumpHostNames={jumpHostNames}
                />
              </section>
            )}
          </div>
        )}
      </ScrollArea>

      <footer className="flex h-9 items-center justify-between border-t px-2 text-xs text-muted-foreground">
        <span>{t("sidebar.count", { count: connections.length })}</span>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("sidebar.import")}
          onClick={() => openImport()}
        >
          <Import className="size-4" />
        </Button>
      </footer>

      {groupDialog !== null && (
        <GroupDialog
          open={groupDialogOpen}
          mode={groupDialog.mode}
          initialId={groupDialog.id}
          initialName={groupDialog.name}
          initialColor={groupDialog.color}
          onCommit={(input, id) =>
            id === null
              ? useConnections.getState().createGroup(input)
              : useConnections.getState().updateGroup(id, input)
          }
          onClose={closeGroupDialog}
        />
      )}

      {confirmDelete !== null && (
        <ConfirmDelete
          open={confirmDeleteOpen}
          kind={confirmDelete.kind}
          name={confirmDelete.name}
          onClose={closeConfirmDelete}
          onConfirm={handleConfirmDelete}
        />
      )}
    </aside>
  );
}

/** A list of connection rows; selection is owned by the Sidebar so only one row is ever highlighted. */
function ConnectionsList({
  connections,
  selectedId,
  onSelectId,
  onConfirmDelete,
  jumpHostNames,
}: {
  connections: readonly Connection[];
  selectedId: string | null;
  onSelectId: (id: string) => void;
  onConfirmDelete: (connection: Connection) => void;
  jumpHostNames: Map<string, string>;
}) {
  const groups = useConnections((state) => state.groups);
  return (
    <div className="flex flex-col gap-0.5">
      {connections.map((connection) => (
        <ConnectionContextMenu
          key={connection.id}
          connection={connection}
          groups={groups}
          onSelectId={onSelectId}
          onConfirmDelete={onConfirmDelete}
        >
          <ConnectionRow
            connection={connection}
            jumpHostName={jumpHostNames.get(connection.id) ?? null}
            selected={connection.id === selectedId}
            onSelect={() => onSelectId(connection.id)}
            onActivate={notifyComingSoon}
          />
        </ConnectionContextMenu>
      ))}
    </div>
  );
}
