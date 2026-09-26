import { FileInput, Search } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SectionHeader } from "@/components/SectionHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { filterConnections } from "@/features/connections/filter";
import { notifyComingSoon } from "@/features/shell/coming-soon";
import type { DemoConnection, DemoGroup } from "@/features/shell/demo-data";
import { ConnectionContextMenu } from "@/features/shell/sidebar/ConnectionContextMenu";
import { ConnectionRow } from "@/features/shell/sidebar/ConnectionRow";
import { GroupSection } from "@/features/shell/sidebar/GroupSection";

interface SidebarProps {
  connections: readonly DemoConnection[];
  groups: readonly DemoGroup[];
}

const byName = (a: DemoConnection, b: DemoConnection) => a.name.localeCompare(b.name);

interface ConnectionsListProps {
  connections: readonly DemoConnection[];
  groups: readonly DemoGroup[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** A list of connection rows. Selection is owned by the Sidebar so only one row is ever highlighted. */
function ConnectionsList({ connections, groups, selectedId, onSelect }: ConnectionsListProps) {
  return (
    <div className="flex flex-col gap-0.5">
      {connections.map((connection) => (
        <ConnectionContextMenu key={connection.id} connection={connection} groups={groups}>
          <ConnectionRow
            connection={connection}
            selected={connection.id === selectedId}
            onSelect={() => onSelect(connection.id)}
            onActivate={notifyComingSoon}
          />
        </ConnectionContextMenu>
      ))}
    </div>
  );
}

export function Sidebar({ connections, groups }: SidebarProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listProps = { groups, selectedId, onSelect: setSelectedId };

  const results = filterConnections(connections, query).sort(byName);
  const favorites = connections.filter((c) => c.favorite).sort(byName);
  const recents = connections
    .filter((c) => c.lastConnectedAt !== null)
    .sort((a, b) => (b.lastConnectedAt ?? 0) - (a.lastConnectedAt ?? 0))
    .slice(0, 5);
  const ungrouped = connections.filter((c) => c.groupId === null).sort(byName);

  return (
    <aside className="flex h-full flex-col bg-sidebar text-sidebar-foreground select-none">
      <div className="p-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="sidebar-filter"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setQuery("");
            }}
            placeholder={t("sidebar.filterPlaceholder")}
            aria-label={t("sidebar.filterPlaceholder")}
            className="pl-8"
          />
        </div>
      </div>

      <ScrollArea className="flex-1 px-2 pb-2">
        {query ? (
          <>
            <SectionHeader title={t("sidebar.results")} />
            {results.length === 0 ? (
              <p className="px-2 py-4 text-xs text-muted-foreground">
                {t("sidebar.noResults", { query })}
              </p>
            ) : (
              <ConnectionsList connections={results} {...listProps} />
            )}
          </>
        ) : (
          <div className="flex flex-col gap-3">
            {favorites.length > 0 && (
              <>
                <SectionHeader title={t("sidebar.favorites")} />
                <ConnectionsList connections={favorites} {...listProps} />
              </>
            )}

            {recents.length > 0 && (
              <>
                <SectionHeader title={t("sidebar.recents")} />
                <ConnectionsList connections={recents} {...listProps} />
              </>
            )}

            {groups.length > 0 && <SectionHeader title={t("sidebar.groups")} />}
            {groups
              .map((group) => ({ group, items: connections.filter((c) => c.groupId === group.id) }))
              .filter(({ items }) => items.length > 0)
              .map(({ group, items }) => (
                <GroupSection
                  key={group.id}
                  title={group.name}
                  color={group.color}
                  count={items.length}
                >
                  <ConnectionsList connections={items.sort(byName)} {...listProps} />
                </GroupSection>
              ))}

            {ungrouped.length > 0 && (
              <>
                <SectionHeader title={t("sidebar.ungrouped")} />
                <ConnectionsList connections={ungrouped} {...listProps} />
              </>
            )}
          </div>
        )}
      </ScrollArea>

      <div className="flex h-10 items-center justify-between border-t px-3 text-xs text-muted-foreground">
        <span className="tabular-nums">{t("sidebar.count", { count: connections.length })}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("sidebar.import")}
              onClick={notifyComingSoon}
            >
              <FileInput className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("sidebar.import")}</TooltipContent>
        </Tooltip>
      </div>
    </aside>
  );
}
