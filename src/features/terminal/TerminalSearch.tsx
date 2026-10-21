import type { SearchAddon } from "@xterm/addon-search";
import { CaseSensitive, ChevronDown, ChevronUp, Regex } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/IconButton";
import { Input } from "@/components/ui/input";
import { Toggle } from "@/components/ui/toggle";
import { DAY_SEARCH, NIGHT_SEARCH, searchDecorations } from "@/features/terminal/themes";
import { useResolvedTheme } from "@/lib/theme";

interface TerminalSearchProps {
  search: SearchAddon;
  open: boolean;
  onClose: () => void;
  onFocusTerminal: () => void;
}

/**
 * The small floating search panel (top-right of the terminal). Each keystroke runs an incremental
 * search with decorations; Enter / Shift+Enter jump to the next / previous match; Escape closes the
 * panel, clears the decorations, and gives the focus back to the terminal.
 */
export function TerminalSearch({ search, open, onClose, onFocusTerminal }: TerminalSearchProps) {
  const { t } = useTranslation();
  const resolvedTheme = useResolvedTheme();
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [count, setCount] = useState({ index: 0, total: 0 });
  const inputRef = useRef<HTMLInputElement>(null);

  // The decoration colors follow the app theme.
  const decorations = useMemo(
    () => searchDecorations(resolvedTheme === "dark" ? NIGHT_SEARCH : DAY_SEARCH),
    [resolvedTheme],
  );

  // Focus the input when the panel opens.
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  // Count the results as they change (only fires with decorations).
  useEffect(() => {
    const off = search.onDidChangeResults(({ resultIndex, resultCount }) => {
      setCount({ index: resultIndex, total: resultCount });
    });
    return () => off.dispose();
  }, [search]);

  // Run the search on each keystroke; clear when the query is empty.
  useEffect(() => {
    if (query.length === 0) {
      search.clearDecorations();
      setCount({ index: 0, total: 0 });
      return;
    }
    search.findNext(query, { caseSensitive, regex, incremental: true, decorations });
  }, [search, query, caseSensitive, regex, decorations]);

  const jump = (previous: boolean): void => {
    if (query.length === 0) {
      return;
    }
    if (previous) {
      search.findPrevious(query, { caseSensitive, regex, decorations });
    } else {
      search.findNext(query, { caseSensitive, regex, decorations });
    }
  };

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      // Enter goes to the next match, Shift+Enter to the previous one.
      jump(event.shiftKey);
    }
  };

  // Escape closes the panel from any of its controls (the field, the arrows or the toggles).
  const onPanelKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      search.clearDecorations();
      // Reopening starts from an empty query rather than a stale, unsearched one.
      setQuery("");
      onClose();
      onFocusTerminal();
    }
  };

  if (!open) {
    return null;
  }

  return (
    <search
      onKeyDown={onPanelKeyDown}
      className="absolute right-3 top-3 flex items-center gap-1 rounded-lg glass shadow-elevated px-2 py-1"
    >
      <Input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onInputKeyDown}
        aria-label={t("terminal.search.label")}
        placeholder={t("terminal.search.label")}
      />
      {query.length > 0 && (
        <span className="min-w-12 select-none text-center text-xs text-muted-foreground">
          {count.total === 0
            ? t("terminal.search.none")
            : t("terminal.search.count", { current: count.index + 1, total: count.total })}
        </span>
      )}
      <IconButton
        variant="outline"
        size="md"
        label={t("terminal.search.previous")}
        onClick={() => jump(true)}
      >
        <ChevronUp className="size-4" />
      </IconButton>
      <IconButton
        variant="outline"
        size="md"
        label={t("terminal.search.next")}
        onClick={() => jump(false)}
      >
        <ChevronDown className="size-4" />
      </IconButton>
      <Toggle
        pressed={caseSensitive}
        onPressedChange={setCaseSensitive}
        aria-label={t("terminal.search.caseSensitive")}
        size="sm"
      >
        <CaseSensitive className="size-4" />
      </Toggle>
      <Toggle
        pressed={regex}
        onPressedChange={setRegex}
        aria-label={t("terminal.search.regex")}
        size="sm"
      >
        <Regex className="size-4" />
      </Toggle>
    </search>
  );
}
