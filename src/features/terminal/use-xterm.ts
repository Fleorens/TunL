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
import { readClipboardText, writeClipboardText } from "@/lib/clipboard";
import { notifyError } from "@/lib/errors";
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
  /** Paste the clipboard; keys typed while it is read are sent after the pasted text. */
  paste: () => void;
}

/**
 * Create and wire an xterm terminal to a port, apply the settings live, fit to its container, and
 * run the terminal's own key handling. The React side keeps the search panel and the per-terminal
 * zoom; this hook only owns the xterm instance.
 *
 * The terminal is created once, the first time the settings are available; later settings, size and
 * theme changes are applied live (never recreated, so the scrollback is kept). `containerRef` is the
 * element xterm opens in, dedicated to it.
 */
export function useXterm(options: UseXtermOptions): UseXterm {
  const { port, containerRef, settings, resolvedTheme, fontSize, active, copyOnSelect, onAction } =
    options;
  const [term, setTerm] = useState<Terminal | null>(null);
  const [search, setSearch] = useState<SearchAddon | null>(null);
  // Fit to the container (only when it has a width: a hidden tab would shrink the PTY to nothing),
  // then tell the port the size (it ignores an unchanged one).
  const fitRef = useRef<() => void>(() => undefined);
  // Paste the clipboard into the live terminal (set at creation).
  const pasteRef = useRef<() => void>(() => undefined);
  // The action to run on a terminal key press, always up to date.
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;
  // The latest settings, theme and size: the one-time creation reads them without depending on them.
  const initialRef = useRef({ settings, resolvedTheme, fontSize });
  initialRef.current = { settings, resolvedTheme, fontSize };
  const ready = settings !== null;

  // Create the terminal once the settings are available; recreate it only when the port changes.
  useEffect(() => {
    const host = containerRef.current;
    const initial = initialRef.current;
    if (!ready || host === null || initial.settings === null) {
      return;
    }
    const term = createTerminal(initial.settings, initial.resolvedTheme, initial.fontSize);
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(
      new WebLinksAddon(
        (event, uri) =>
          event.ctrlKey && isOpenableUrl(uri) && void openExternal(uri).catch(notifyError),
      ),
    );

    const fitting = wireFit(term, fit, host, port);
    fitRef.current = fitting.fitNow;
    const pasting = wirePaste(term, port);
    pasteRef.current = pasting.paste;
    const unsubscribe = port.subscribe((bytes) => term.write(bytes));
    term.onResize(({ cols, rows }) => port.resize(cols, rows));
    wireKeys(term, onActionRef);

    term.open(host);
    loadWebgl(term);
    setTerm(term);
    setSearch(search);

    return () => {
      fitRef.current = () => undefined;
      pasteRef.current = () => undefined;
      fitting.dispose();
      unsubscribe();
      pasting.dispose();
      term.dispose();
      setTerm(null);
      setSearch(null);
    };
  }, [port, containerRef, ready]);

  // Apply the settings live: change the options, then refit (the scrollback is kept).
  useEffect(() => {
    if (!term || !settings) {
      return;
    }
    term.options.fontFamily = `"${settings.fontFamily}", monospace`;
    term.options.fontSize = fontSize;
    term.options.lineHeight = settings.lineHeight;
    term.options.cursorStyle = settings.cursorStyle;
    term.options.cursorBlink = settings.cursorBlink;
    term.options.scrollback = settings.scrollback;
    term.options.theme = resolveTerminalTheme(settings.theme, resolvedTheme === "dark");
    requestAnimationFrame(() => fitRef.current());
  }, [term, settings, resolvedTheme, fontSize]);

  // Copy on selection: write the selection when it is not empty.
  useEffect(() => {
    if (!term || !copyOnSelect) {
      return;
    }
    const off = term.onSelectionChange(() => {
      const selection = term.getSelection();
      if (selection.length > 0) {
        writeClipboardText(selection).catch(notifyError);
      }
    });
    return () => off.dispose();
  }, [term, copyOnSelect]);

  // When the tab becomes active, fit (it was hidden) and focus the terminal.
  useEffect(() => {
    if (!term || !active) {
      return;
    }
    requestAnimationFrame(() => fitRef.current());
    term.focus();
  }, [term, active]);

  return { term, search, paste: () => pasteRef.current() };
}

function createTerminal(
  settings: TerminalSettings,
  resolvedTheme: ResolvedTheme,
  fontSize: number,
): Terminal {
  return new Terminal({
    fontFamily: `"${settings.fontFamily}", monospace`,
    fontSize,
    lineHeight: settings.lineHeight,
    cursorStyle: settings.cursorStyle,
    cursorBlink: settings.cursorBlink,
    scrollback: settings.scrollback,
    theme: resolveTerminalTheme(settings.theme, resolvedTheme === "dark"),
    allowProposedApi: true,
  });
}

/** WebGL rendering, except with the mock (the e2e read the text out of the DOM rows). */
function loadWebgl(term: Terminal): void {
  if (isMockBackend) {
    return;
  }
  try {
    const gl = new WebglAddon();
    // On context loss, drop the addon only: xterm falls back to the DOM renderer.
    gl.onContextLoss(() => gl.dispose());
    term.loadAddon(gl);
  } catch {
    // WebGL unavailable: keep the DOM renderer.
  }
}

/**
 * Fit the terminal to its element, then tell the port the size (it ignores an unchanged one). Only
 * when the element has a width: a hidden tab would shrink the PTY to nothing. Refit on resize and once
 * the fonts are ready (xterm measures the cell at open). Nothing runs once disposed.
 */
function wireFit(
  term: Terminal,
  fit: FitAddon,
  host: HTMLElement,
  port: TerminalPort,
): { fitNow: () => void; dispose: () => void } {
  let disposed = false;
  const fitNow = (): void => {
    if (disposed || host.clientWidth === 0) {
      return;
    }
    fit.fit();
    port.resize(term.cols, term.rows);
  };
  const observer = new ResizeObserver(() => requestAnimationFrame(fitNow));
  observer.observe(host);
  void document.fonts.ready.then(fitNow);
  return {
    fitNow,
    dispose: () => {
      disposed = true;
      observer.disconnect();
    },
  };
}

/** Run the terminal's own shortcuts; every other key goes to xterm. */
function wireKeys(term: Terminal, onActionRef: { current: (action: TerminalKeyAction) => void }) {
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
}

/** How long the keys typed during a paste wait for the clipboard before being sent anyway. */
const PASTE_TIMEOUT_MS = 2000;

/**
 * Send the typed keys to the port, and paste the clipboard. The clipboard is read asynchronously: the
 * keys typed meanwhile are held, then sent after the pasted text, so they keep their order. A clipboard
 * that never answers releases the keys after a delay; text arriving later is still pasted. Nothing
 * runs once disposed.
 */
function wirePaste(term: Terminal, port: TerminalPort): { paste: () => void; dispose: () => void } {
  let held: string[] | null = null;
  let disposed = false;
  const onData = term.onData((data) => (held ? held.push(data) : port.write(data)));
  const paste = (): void => {
    if (held) {
      return;
    }
    const keys: string[] = [];
    held = keys;
    // Stop holding, paste the text (its data goes straight to the port), then send this paste's held
    // keys if they were not already released by the delay.
    const release = (text: string): void => {
      if (disposed) {
        return;
      }
      const mine = held === keys;
      if (mine) {
        held = null;
      }
      if (text.length > 0) {
        term.paste(text);
      }
      for (const data of mine ? keys : []) {
        port.write(data);
      }
    };
    const timer = setTimeout(() => release(""), PASTE_TIMEOUT_MS);
    readClipboardText()
      .then(release)
      .catch((error) => {
        release("");
        notifyError(error);
      })
      .finally(() => clearTimeout(timer));
  };
  return {
    paste,
    dispose: () => {
      disposed = true;
      onData.dispose();
    },
  };
}
