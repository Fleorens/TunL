// The entries of one SFTP folder: a virtualized, sortable, keyboard-navigable table (docs/04 §6).
// A plain `<table>` (no ARIA grid): the rows are absolutely positioned by `useVirtualizer` inside a grid `tbody`.

import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronUp, File, FileQuestion, Folder, Link2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { EntryKind } from "@/bindings/EntryKind";
import type { RemoteEntry } from "@/bindings/RemoteEntry";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { SortKey, SortOrder } from "./sftp-model";
import { formatMode, formatSize } from "./sftp-model";

const ROW_HEIGHT = 32;
const OVERSCAN = 12;
// The column template, set on every row (header included) so the cells line up.
const ROW_GRID = "grid w-full grid-cols-[minmax(0,1fr)_6rem_10rem_7.5rem]";

interface EntryTableProps {
  entries: readonly RemoteEntry[];
  sort: SortOrder;
  onSort: (key: SortKey) => void;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onOpen: (entry: RemoteEntry) => void;
  onUp: () => void;
  /** The path of the entry being renamed in place, or `null`. */
  renaming: string | null;
  onRename: (entry: RemoteEntry) => void;
  /** The new name (Enter), or `null` when the rename is given up (Escape, focus lost). */
  onRenameDone: (entry: RemoteEntry, name: string | null) => void;
  onDelete: (entry: RemoteEntry) => void;
}

/** The icon of one entry: a folder, a file, a link, or an unknown kind. */
function EntryIcon({ kind }: { kind: EntryKind }) {
  const cls = kind === "dir" ? "text-primary" : "text-muted-foreground";
  const Icon =
    kind === "dir" ? Folder : kind === "symlink" ? Link2 : kind === "file" ? File : FileQuestion;
  return <Icon className={`size-3.5 shrink-0 ${cls}`} aria-hidden />;
}

/** One sorted column header: an `aria-sort`, a button that sorts, and an arrow on the active column. */
function SortHeader({
  sortKey,
  order,
  onSort,
}: {
  sortKey: SortKey;
  order: SortOrder;
  onSort: (key: SortKey) => void;
}) {
  const { t } = useTranslation();
  const active = order.key === sortKey;
  return (
    <th
      aria-sort={active ? (order.ascending ? "ascending" : "descending") : "none"}
      className="min-w-0 px-2 text-xs font-medium text-muted-foreground"
    >
      <button
        type="button"
        aria-label={t(`sftp.columns.${sortKey}`)}
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex h-6 w-full items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground",
          // Size, Modified and Permissions are right-aligned like their cells (lot 5 review).
          sortKey === "name" ? "pr-1" : "justify-end",
        )}
      >
        {t(`sftp.columns.${sortKey}`)}
        {active && (
          <span aria-hidden className="inline-flex size-3.5">
            {order.ascending ? <ChevronUp /> : <ChevronDown />}
          </span>
        )}
      </button>
    </th>
  );
}

/**
 * The name cell while renaming: the name selected without its extension, Enter keeps, Escape or a lost focus gives
 * up. Every key stops here, or Enter would open the entry and Backspace go up a folder.
 */
function RenameField({
  entry,
  onDone,
}: {
  entry: RemoteEntry;
  onDone: (entry: RemoteEntry, name: string | null) => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(entry.name);
  // Enter then the blur of the unmount would answer twice: only the first one counts.
  const done = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const dot = entry.name.lastIndexOf(".");
    inputRef.current?.setSelectionRange(0, dot > 0 ? dot : entry.name.length);
  }, [entry.name]);

  const finish = (name: string | null): void => {
    if (done.current) return;
    done.current = true;
    onDone(entry, name);
  };

  return (
    <Input
      ref={inputRef}
      autoFocus
      autoComplete="off"
      aria-label={t("sftp.menu.rename")}
      className="h-6 min-w-0 px-1 py-0 text-sm"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => finish(null)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") finish(value);
        else if (event.key === "Escape") finish(null);
      }}
    />
  );
}

/**
 * One row: icon, truncated name (grayed when hidden), size, date, rights. Declared at module level, so React keeps
 * the same instance across renders.
 */
function EntryRow({
  entry,
  index,
  isSelected,
  tabIndex,
  top,
  height,
  locale,
  dateFormat,
  rowRef,
  renaming,
  onSelect,
  onOpen,
  onRenameDone,
}: {
  entry: RemoteEntry;
  index: number;
  isSelected: boolean;
  tabIndex: number;
  top: number;
  height: number;
  locale: string;
  dateFormat: Intl.DateTimeFormat;
  rowRef: (node: HTMLTableRowElement | null) => void;
  renaming: boolean;
  onSelect: (path: string) => void;
  onOpen: (entry: RemoteEntry) => void;
  onRenameDone: (entry: RemoteEntry, name: string | null) => void;
}) {
  const sizeText = entry.kind === "dir" ? "—" : formatSize(entry.size, locale);
  const dateText = entry.modifiedAt == null ? "—" : dateFormat.format(entry.modifiedAt);
  const modeText = formatMode(entry.kind, entry.permissions);
  return (
    <tr
      ref={rowRef}
      data-index={index}
      aria-rowindex={index + 2}
      style={{ position: "absolute", top: 0, height, transform: `translateY(${top}px)` }}
      tabIndex={tabIndex}
      aria-selected={isSelected}
      onClick={() => onSelect(entry.path)}
      onDoubleClick={() => {
        if (!renaming) onOpen(entry);
      }}
      onContextMenu={() => onSelect(entry.path)}
      className={cn(
        ROW_GRID,
        "cursor-default items-center outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
        isSelected && "bg-accent text-accent-foreground hover:bg-accent",
      )}
    >
      <td className="flex min-w-0 items-center gap-1.5 px-2">
        <EntryIcon kind={entry.kind} />
        {renaming ? (
          <RenameField entry={entry} onDone={onRenameDone} />
        ) : (
          <span className={cn("min-w-0 truncate", entry.hidden && "text-muted-foreground")}>
            {entry.name}
          </span>
        )}
      </td>
      <td className="whitespace-nowrap px-2 text-right text-xs text-muted-foreground">
        {sizeText}
      </td>
      <td className="whitespace-nowrap px-2 text-right text-xs text-muted-foreground">
        {dateText}
      </td>
      <td className="whitespace-nowrap px-2 text-right">
        <span className="font-mono text-xs text-muted-foreground">{modeText}</span>
      </td>
    </tr>
  );
}

export function EntryTable({
  entries,
  sort,
  onSort,
  selectedPath,
  onSelect,
  onOpen,
  onUp,
  renaming,
  onRename,
  onRenameDone,
  onDelete,
}: EntryTableProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
    [locale],
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  // The row nodes, by index, to refocus after a keyboard move.
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  // Whether focus is inside the table body, so a keyboard move can give it to the new row.
  const tableHasFocus = useRef(false);

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  const totalSize = virtualizer.getTotalSize();
  const virtualItems = virtualizer.getVirtualItems();

  // The selected row takes the focus when it is in the table or nowhere (after a rename or a dialog), never while
  // renaming.
  useEffect(() => {
    if (renaming !== null) return;
    if (!tableHasFocus.current && document.activeElement !== document.body) return;
    const index = entries.findIndex((entry) => entry.path === selectedPath);
    rowRefs.current[index]?.focus();
  }, [selectedPath, entries, renaming]);

  const focusIndex = (index: number): void => {
    const entry = entries[index];
    if (!entry) return;
    onSelect(entry.path);
    virtualizer.scrollToIndex(index);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTableSectionElement>): void => {
    const count = entries.length;
    if (count === 0) return;
    const currentIndex = selectedPath
      ? entries.findIndex((entry) => entry.path === selectedPath)
      : -1;
    let index = currentIndex;
    switch (event.key) {
      case "ArrowDown":
        index = Math.min(count - 1, (currentIndex < 0 ? -1 : currentIndex) + 1);
        break;
      case "ArrowUp":
        index = Math.max(0, currentIndex - 1);
        break;
      case "Home":
        index = 0;
        break;
      case "End":
        index = count - 1;
        break;
      case "Enter": {
        const entry = currentIndex >= 0 ? entries[currentIndex] : undefined;
        if (entry) onOpen(entry);
        return;
      }
      case "Backspace":
        onUp();
        return;
      case "F2":
      case "Delete": {
        const entry = currentIndex >= 0 ? entries[currentIndex] : undefined;
        if (!entry) return;
        event.preventDefault();
        if (event.key === "F2") onRename(entry);
        else onDelete(entry);
        return;
      }
      default:
        return;
    }
    event.preventDefault();
    focusIndex(index);
  };

  // The first row is focusable when nothing is selected, so the table is reachable by Tab.
  const tabIndexFor = (index: number): number =>
    selectedPath === entries[index]?.path ? 0 : selectedPath === null ? (index === 0 ? 0 : -1) : -1;

  return (
    <div ref={containerRef} className="h-full overflow-auto">
      <table
        aria-label={t("sftp.files")}
        aria-rowcount={entries.length + 1}
        className="grid w-full"
      >
        <thead className="sticky top-0 z-10 grid w-full bg-background">
          <tr className={ROW_GRID}>
            <SortHeader sortKey="name" order={sort} onSort={onSort} />
            <SortHeader sortKey="size" order={sort} onSort={onSort} />
            <SortHeader sortKey="modified" order={sort} onSort={onSort} />
            <SortHeader sortKey="permissions" order={sort} onSort={onSort} />
          </tr>
        </thead>
        <tbody
          className="relative grid w-full"
          style={{ height: `${totalSize}px` }}
          onKeyDown={onKeyDown}
          onFocus={() => {
            tableHasFocus.current = true;
          }}
          onBlur={(event) => {
            tableHasFocus.current = event.currentTarget.contains(event.relatedTarget);
          }}
        >
          {virtualItems.map((virtual) => {
            const entry = entries[virtual.index];
            return (
              <EntryRow
                key={virtual.index}
                entry={entry}
                index={virtual.index}
                isSelected={selectedPath === entry.path}
                tabIndex={tabIndexFor(virtual.index)}
                top={virtual.start}
                height={virtual.size}
                locale={locale}
                dateFormat={dateFormat}
                rowRef={(node) => {
                  rowRefs.current[virtual.index] = node;
                }}
                renaming={renaming === entry.path}
                onSelect={onSelect}
                onOpen={onOpen}
                onRenameDone={onRenameDone}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
