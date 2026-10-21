import type { ParseKeys } from "i18next";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { shortcutRows } from "@/features/palette/palette-model";
import { LIST_SHORTCUTS, type ShortcutId, TERMINAL_SHORTCUTS } from "@/features/shell/shortcuts";
import { useUi } from "@/features/shell/ui-store";

// The labels are keyed by the shortcut id, and the values are literal i18n keys (typed): a string
// built with `` `shortcuts.labels.${id}` `` would not type-check, so the table spells each one out.
type Key = ParseKeys;

const LABELS: Record<ShortcutId, Key> = {
  "palette.open": "shortcuts.labels.palette.open",
  "palette.quickConnect": "shortcuts.labels.palette.quickConnect",
  "connection.new": "shortcuts.labels.connection.new",
  "tab.close": "shortcuts.labels.tab.close",
  "tab.next": "shortcuts.labels.tab.next",
  "tab.previous": "shortcuts.labels.tab.previous",
  "tab.goTo1": "shortcuts.labels.tab.goTo1",
  "tab.goTo2": "shortcuts.labels.tab.goTo2",
  "tab.goTo3": "shortcuts.labels.tab.goTo3",
  "tab.goTo4": "shortcuts.labels.tab.goTo4",
  "tab.goTo5": "shortcuts.labels.tab.goTo5",
  "tab.goTo6": "shortcuts.labels.tab.goTo6",
  "tab.goTo7": "shortcuts.labels.tab.goTo7",
  "tab.goTo8": "shortcuts.labels.tab.goTo8",
  "tab.goTo9": "shortcuts.labels.tab.goTo9",
  "sidebar.toggle": "shortcuts.labels.sidebar.toggle",
  "sidebar.filter": "shortcuts.labels.sidebar.filter",
  "settings.open": "shortcuts.labels.settings.open",
  "help.shortcuts": "shortcuts.labels.help.shortcuts",
};

export function ShortcutsDialog() {
  const { t } = useTranslation();
  const open = useUi((state) => state.shortcutsOpen);
  const closeShortcuts = useUi((state) => state.closeShortcuts);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && closeShortcuts()}>
      <DialogContent className="max-h-[80vh] w-full max-w-120 overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("shortcuts.title")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-2">
          {shortcutRows().map((row) => (
            <div key={row.id} className="grid grid-cols-[1fr_auto] items-center gap-6">
              <span className="truncate">{t(LABELS[row.id])}</span>
              <div className="flex shrink-0 items-center gap-1">
                {row.display.map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-2">
          <h3 className="px-1 text-xs font-medium uppercase tracking-wider text-subtle-foreground">
            {t("shortcuts.terminal.title")}
          </h3>
          {TERMINAL_SHORTCUTS.map((row) => (
            <div key={row.id} className="grid grid-cols-[1fr_auto] items-center gap-6">
              <span className="truncate">{t(`shortcuts.terminal.${row.id}`)}</span>
              <div className="flex shrink-0 items-center gap-1">
                {row.display.map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-2">
          <h3 className="px-1 text-xs font-medium uppercase tracking-wider text-subtle-foreground">
            {t("shortcuts.lists.title")}
          </h3>
          {LIST_SHORTCUTS.map((row) => (
            <div key={row.id} className="grid grid-cols-[1fr_auto] items-center gap-6">
              <span className="truncate">{t(`shortcuts.lists.${row.id}`)}</span>
              <div className="flex shrink-0 items-center gap-1">
                {row.display.map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
