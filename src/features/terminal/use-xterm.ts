import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import type { TerminalSettings } from "@/bindings/TerminalSettings";
import type { TerminalPort } from "@/features/terminal/port";
import type { TerminalKeyAction } from "@/features/terminal/terminal-keys";
import { isOpenableUrl, terminalKeyAction } from "@/features/terminal/terminal-keys";
import { resolveTerminalTheme } from "@/features/terminal/themes";
import { writeClipboardText } from "@/lib/clipboard";
import { isMockBackend } from "@/lib/ipc";
import { openExternal } from "@/lib/opener";
import type { ResolvedTheme } from "@/lib/theme";

interface UseXtermOptions {
  port: TerminalPort;
  containerRef: React.RefObject<HTMLDivElement | null>;
  settings: TerminalSettings | null;
  resolvedTheme: ResolvedTheme;
  /** The per-terminal font size (its own zoom, separate from the global setting). */
  fontSize: number;
  active: boolean;
  copyOnSelect: boolean;
  onAction: (action: TerminalKeyAction) => void;
}

interface UseXterm {
  term: Terminal | null;
  search: SearchAddon | null;
}

/**
 * Create and wire an xterm terminal to a port, apply the settings live, fit to its container, and
 * run the terminal's own key handling. The React side keeps the search panel and the per-terminal
 * zoom; this hook only owns the xterm instance.
 *
 * The terminal is created once, the first time the settings are available; later settings, size and
 * theme changes are applied live (never recreated, so the scrollback is kept).
 */
export function useXterm(options: UseXtermOptions): UseXterm {
  const { port, containerRef, settings, resolvedTheme, fontSize, active, copyOnSelect, onAction } =
    options;
  const [term, setTerm] = useState<Terminal | null>(null);
  const [search, setSearch] = useState<SearchAddon | null>(null);
  // The live terminal, so the settings/active effects can reach it without recreating it.
  const termRef = useRef<Terminal | null>(null);
  // The fit addon, so the settings effect can refit after applying the options.
  const fitRef = useRef<FitAddon | null>(null);
  // The action to run on a terminal key press, always up to date.
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;
  // The resolved theme, always up to date (the one-time creation reads it without depending on it).
  const resolvedThemeRef = useRef(resolvedTheme);
  resolvedThemeRef.current = resolvedTheme;
  // Guard the one-time creation against the settings loading after mount.
  const createdRef = useRef(false);

  // Create the terminal once, the first time the settings are available.
  useEffect(() => {
    if (!settings || createdRef.current) {
      return;
    }
    createdRef.current = true;

    const host = containerRef.current;
    if (host === null) {
      return;
    }

    const term = new Terminal({
      fontFamily: `"${settings.fontFamily}", monospace`,
      fontSize: settings.fontSize,
      lineHeight: settings.lineHeight,
      cursorStyle: settings.cursorStyle,
      cursorBlink: settings.cursorBlink,
      scrollback: settings.scrollback,
      theme: resolveTerminalTheme(settings.theme, resolvedThemeRef.current === "dark"),
      allowProposedApi: true,
    });
    termRef.current = term;

    const fit = new FitAddon();
    const search = new SearchAddon();
    fitRef.current = fit;
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(
      new WebLinksAddon(
        (event, uri) => event.ctrlKey && isOpenableUrl(uri) && void openExternal(uri),
      ),
    );
    // WebGL is off in the mock: the e2e read the text out of the DOM.
    if (!isMockBackend) {
      try {
        const gl = new WebglAddon();
        // On context loss, fall back to the DOM renderer by disposing the terminal.
        gl.onContextLoss(() => term.dispose());
        term.loadAddon(gl);
      } catch {
        // WebGL unavailable: keep the DOM renderer.
      }
    }
    setTerm(term);
    setSearch(search);

    // Fit on the next frame, but only when the container has a non-zero width (not hidden).
    const fitNow = (): void => {
      if (containerRef.current?.clientWidth === 0) {
        return;
      }
      fit.fit();
    };

    term.onData((data) => port.write(data));
    const unsubscribe = port.subscribe((bytes) => term.write(bytes));
    term.onResize(({ cols, rows }) => port.resize(cols, rows));

    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") {
        return true;
      }
      const action = terminalKeyAction(event);
      if (action) {
        onActionRef.current(action);
        event.preventDefault();
        // Returning false is the documented "handled" signal (xterm ignores the return value).
        return false;
      }
      return true;
    });

    term.open(host);

    const observer = new ResizeObserver(() => requestAnimationFrame(fitNow));
    observer.observe(host);
    // xterm measures the cell at open; wait for the fonts to be ready so the first fit is right.
    void document.fonts.ready.then(fitNow);

    return () => {
      // Allow a remount (tab switch) to recreate the terminal.
      createdRef.current = false;
      observer.disconnect();
      unsubscribe();
      term.dispose();
    };
    // Re-run only when the port changes (before the settings load): keep the terminal otherwise.
  }, [port, containerRef, settings]);

  // Apply the settings live: change an option, then refit.
  useEffect(() => {
    const term = termRef.current;
    if (!term) {
      return;
    }
    term.options.fontFamily = `"${settings?.fontFamily}", monospace`;
    term.options.fontSize = fontSize;
    term.options.lineHeight = settings?.lineHeight ?? 1;
    term.options.cursorStyle = settings?.cursorStyle;
    term.options.cursorBlink = settings?.cursorBlink ?? true;
    term.options.scrollback = settings?.scrollback ?? 1000;
    term.options.theme = resolveTerminalTheme(settings?.theme ?? "auto", resolvedTheme === "dark");
    requestAnimationFrame(() => fitRef.current?.fit());
  }, [settings, resolvedTheme, fontSize]);

  // Copy on selection: write the selection when it is not empty.
  useEffect(() => {
    const term = termRef.current;
    if (!term || !copyOnSelect) {
      return;
    }
    const off = term.onSelectionChange(() => {
      const selection = term.getSelection();
      if (selection.length > 0) {
        void writeClipboardText(selection);
      }
    });
    return () => off.dispose();
  }, [copyOnSelect]);

  // When the tab becomes active, fit (it was hidden) and focus the terminal.
  useEffect(() => {
    const term = termRef.current;
    if (!term || !active) {
      return;
    }
    fitRef.current?.fit();
    term.focus();
  }, [active]);

  return { term, search };
}
