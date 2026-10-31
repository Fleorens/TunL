import { FolderTree, Save } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ProtocolIcon } from "@/components/ProtocolIcon";
import { ShortcutHint } from "@/components/ShortcutHint";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { filterConnections, normalizeForSearch } from "@/features/connections/filter";
import { openImport } from "@/features/connections/open-import";
import { compareNames } from "@/features/connections/sections";
import { useConnections } from "@/features/connections/store";
import {
  filterActions,
  nextTheme,
  PALETTE_ACTIONS,
  type PaletteActionId,
} from "@/features/palette/palette-model";
import {
  formatQuickTarget,
  parseQuickConnect,
  type QuickTarget,
} from "@/features/palette/quick-connect";
import { openQuickSession, openSession, openSftpFrom } from "@/features/sessions/open-session";
import { useSessions } from "@/features/sessions/store";
import { useSettings } from "@/features/settings/store";
import { SHORTCUTS, type ShortcutId } from "@/features/shell/shortcuts";
import { type PaletteMode, useUi } from "@/features/shell/ui-store";
import { notifyError } from "@/lib/errors";

/** Unique cmdk values, so the highlighted one can be matched back to what it opened. */
const QUICK_CONNECT = "quick-connect";
const SAVE = "save";
const TAB_SFTP = "tab-open-sftp";
const actionValue = (id: PaletteActionId) => `action:${id}`;

export function CommandPalette() {
  const { t } = useTranslation();
  const mode = useUi((state) => state.palette);
  const closePalette = useUi((state) => state.closePalette);
  const connections = useConnections((state) => state.connections);

  const [search, setSearch] = useState("");
  // The highlighted item is controlled so it can jump back to the first result on every search change.
  const [selected, setSelected] = useState("");

  // The actions, translated once, so the filter and the labels can never drift apart.
  const labels = useMemo<Record<PaletteActionId, string>>(
    () => ({
      newConnection: t("palette.actions.newConnection"),
      importSshConfig: t("palette.actions.importSshConfig"),
      toggleTheme: t("palette.actions.toggleTheme"),
      shortcuts: t("palette.actions.shortcuts"),
      settings: t("palette.actions.settings"),
    }),
    [t],
  );

  const matched = useMemo(
    () => filterConnections(connections, search).sort((a, b) => compareNames(a.name, b.name)),
    [connections, search],
  );
  const quickTarget = useMemo(() => parseQuickConnect(search), [search]);
  const actionIds = useMemo(() => filterActions(labels, search), [labels, search]);

  // "Open in SFTP" for the active terminal tab: shown only when the active tab is SSH, and filtered like the
  // actions. It is not an action (not in `PALETTE_ACTIONS`), so it lives in its own group.
  const activeSession = useSessions((s) => s.sessions.find((x) => x.id === s.activeId));
  const tabAction = useMemo(() => {
    if (activeSession?.kind !== "ssh") return null;
    const label = t("tabMenu.openSftp");
    const terms = normalizeForSearch(search).split(/\s+/).filter(Boolean);
    if (terms.length === 0 || terms.every((term) => normalizeForSearch(label).includes(term))) {
      return label;
    }
    return null;
  }, [activeSession, search, t]);

  // The first visible item, so the highlight can reset to it whenever the list changes. An RDP target has no
  // « RDP to … » row, so its first row is « Save as a new connection… ».
  const firstValue = useMemo(() => {
    if (mode === "quickConnect") {
      if (!quickTarget) return "";
      return quickTarget.protocol === "rdp" ? SAVE : QUICK_CONNECT;
    }
    if (matched.length > 0) return matched[0].id;
    if (tabAction) return TAB_SFTP;
    if (quickTarget) return quickTarget.protocol === "rdp" ? SAVE : QUICK_CONNECT;
    return actionIds.length > 0 ? actionValue(actionIds[0]) : "";
  }, [mode, quickTarget, matched, actionIds, tabAction]);

  // Reset the search each time the palette opens: a mode switch or a reopen.
  const prevMode = useRef<PaletteMode | null>(null);
  useEffect(() => {
    if (mode !== prevMode.current) {
      setSearch("");
      prevMode.current = mode;
    }
  }, [mode]);

  // Keep the highlight on the first visible item as the list changes.
  useEffect(() => {
    setSelected(firstValue);
  }, [firstValue]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter") return;
    const connection = selected ? connections.find((c) => c.id === selected) : undefined;
    const mod = event.ctrlKey || event.metaKey;
    // Ctrl+Enter and Alt+Enter must be prevented before cmdk reaches onSelect, otherwise the
    // connection opens in addition to the SFTP view or the editor.
    if (mod && connection) {
      event.preventDefault();
      closePalette();
      openSession(connection, connection.settings.protocol === "ssh" ? "sftp" : undefined);
      return;
    }
    if (event.altKey && connection) {
      event.preventDefault();
      closePalette();
      useUi.getState().openEditor({ mode: "edit", id: connection.id });
    }
  };

  if (mode === null) return null;

  return (
    <CommandDialog
      open={mode !== null}
      onOpenChange={(next) => !next && closePalette()}
      title={t("palette.title")}
      description={t("palette.description")}
      className="w-[640px] glass shadow-elevated sm:max-w-[640px]"
    >
      <Command
        value={selected}
        onValueChange={setSelected}
        shouldFilter={false}
        onKeyDown={onKeyDown}
      >
        <CommandInput
          value={search}
          onValueChange={setSearch}
          placeholder={
            mode === "quickConnect" ? t("palette.quickPlaceholder") : t("palette.placeholder")
          }
        />
        <CommandList>
          {mode === "all" && (
            <>
              {matched.length > 0 && (
                <CommandGroup heading={t("palette.groups.connections")}>
                  {matched.map((connection) => (
                    <CommandItem
                      key={connection.id}
                      value={connection.id}
                      onSelect={() => {
                        closePalette();
                        openSession(connection);
                      }}
                    >
                      <ProtocolIcon protocol={connection.settings.protocol} className="size-4" />
                      <span className="flex-1 truncate">{connection.name}</span>
                      <span className="truncate text-muted-foreground">
                        {connection.username
                          ? `${connection.username}@${connection.host}`
                          : connection.host}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {tabAction && (
                <CommandGroup heading={t("palette.groups.tab")}>
                  <CommandItem
                    value={TAB_SFTP}
                    onSelect={() => {
                      closePalette();
                      if (activeSession) openSftpFrom(activeSession);
                    }}
                  >
                    <FolderTree className="size-4" />
                    <span className="flex-1 truncate">{tabAction}</span>
                  </CommandItem>
                </CommandGroup>
              )}

              {quickTarget && (
                <CommandGroup heading={t("palette.groups.quickConnect")}>
                  <QuickConnectGroup target={quickTarget} />
                </CommandGroup>
              )}

              {actionIds.length > 0 && (
                <CommandGroup heading={t("palette.groups.actions")}>
                  {actionIds.map((id) => (
                    <CommandItem
                      key={actionValue(id)}
                      value={actionValue(id)}
                      onSelect={() => {
                        closePalette();
                        runAction(id);
                      }}
                    >
                      <span className="flex-1 truncate">{labels[id]}</span>
                      <ActionShortcut id={id} />
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </>
          )}

          {mode === "quickConnect" && (
            <CommandGroup heading={t("palette.groups.quickConnect")}>
              {quickTarget && <QuickConnectGroup target={quickTarget} />}
            </CommandGroup>
          )}

          <CommandEmpty>{t("palette.noResults")}</CommandEmpty>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

/**
 * The quick-connect rows. For SSH: the « SSH to … » row, then « Save as a new connection… » (so Enter opens the
 * session). For RDP, which opens a tab only on a saved connection: only « Save as a new connection… », which is what
 * Enter picks and fills the editor with.
 */
function QuickConnectGroup({ target }: { target: QuickTarget }) {
  const { t } = useTranslation();
  const closePalette = useUi((state) => state.closePalette);

  return (
    <>
      {target.protocol === "ssh" && (
        <CommandItem
          value={QUICK_CONNECT}
          onSelect={() => {
            closePalette();
            openQuickSession(target);
          }}
        >
          <ProtocolIcon protocol="ssh" className="size-4" />
          <span className="flex-1 truncate">
            {t("palette.quickConnectTo", {
              protocol: t("protocols.ssh"),
              target: formatQuickTarget(target),
            })}
          </span>
        </CommandItem>
      )}
      <CommandItem
        value={SAVE}
        onSelect={() => {
          closePalette();
          useUi.getState().openEditor({
            mode: "create",
            protocol: target.protocol,
            prefill: {
              host: target.host,
              port: target.port,
              username: target.username,
            },
          });
        }}
      >
        <Save className="size-4" />
        <span className="flex-1 truncate">{t("palette.saveAsConnection")}</span>
      </CommandItem>
    </>
  );
}

/** The shortcut keys shown to the right of an action, when the action has one. */
function ActionShortcut({ id }: { id: PaletteActionId }) {
  const shortcut = PALETTE_ACTIONS.find((action) => action.id === id)
    ?.shortcut as ShortcutId | null;
  const keys = shortcut ? (SHORTCUTS.find((s) => s.id === shortcut)?.display ?? []) : [];
  if (keys.length === 0) return null;
  return (
    <CommandShortcut>
      <ShortcutHint keys={keys} />
    </CommandShortcut>
  );
}

/** What each palette action does. Every action closes the palette first. */
function runAction(id: PaletteActionId) {
  switch (id) {
    case "newConnection":
      useUi.getState().openEditor({ mode: "create" });
      break;
    case "importSshConfig":
      openImport();
      break;
    case "toggleTheme":
      void toggleTheme();
      break;
    case "shortcuts":
      useUi.getState().openShortcuts();
      break;
    case "settings":
      useSessions.getState().openSettings();
      break;
  }
}

async function toggleTheme() {
  const current = useSettings.getState().settings;
  if (!current) return;
  const next = nextTheme(current.theme, window.matchMedia("(prefers-color-scheme: dark)").matches);
  const result = await useSettings.getState().update({ ...current, theme: next });
  if (!result.ok) notifyError(result.error);
}
