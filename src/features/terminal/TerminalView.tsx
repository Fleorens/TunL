import { useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";
import { useSettings } from "@/features/settings/store";
import type { TerminalPort } from "@/features/terminal/port";
import { type TerminalKeyAction, zoomFontSize } from "@/features/terminal/terminal-keys";
import { resolveTerminalTheme } from "@/features/terminal/themes";
import { useXterm } from "@/features/terminal/use-xterm";
import { readClipboardText, writeClipboardText } from "@/lib/clipboard";
import { notifyError } from "@/lib/errors";
import { useResolvedTheme } from "@/lib/theme";
import { TerminalSearch } from "./TerminalSearch";

/**
 * The terminal itself, speaking to a port (T21 will wire it to `ipc.sshOpen`; the gallery wires it
 * to a local echo). It owns the xterm instance through `useXterm`, the per-terminal zoom, and the
 * search panel.
 */
export function TerminalView({ port, active }: { port: TerminalPort; active: boolean }) {
  const resolvedTheme = useResolvedTheme();
  const terminal = useSettings((state) => state.settings?.terminal);
  const [fontSize, setFontSize] = useState(terminal?.fontSize ?? 13);
  const [searchOpen, setSearchOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { term, search } = useXterm({
    port,
    containerRef,
    settings: terminal ?? null,
    resolvedTheme,
    fontSize,
    active,
    copyOnSelect: terminal?.copyOnSelect ?? false,
    onAction: (action: TerminalKeyAction) => {
      switch (action) {
        case "copy": {
          const selection = term?.getSelection() ?? "";
          if (selection.length > 0) {
            void writeClipboardText(selection);
          }
          break;
        }
        case "paste":
          readClipboardText()
            .then((text) => term?.paste(text))
            .catch((error) => notifyError(error));
          break;
        case "search":
          setSearchOpen(true);
          break;
        case "zoomIn":
          setFontSize((current) => zoomFontSize(current, "in", terminal?.fontSize ?? 13));
          break;
        case "zoomOut":
          setFontSize((current) => zoomFontSize(current, "out", terminal?.fontSize ?? 13));
          break;
        case "zoomReset":
          setFontSize((current) => zoomFontSize(current, "reset", terminal?.fontSize ?? 13));
          break;
      }
    },
  });

  const theme = terminal ? resolveTerminalTheme(terminal.theme, resolvedTheme === "dark") : null;

  return (
    <div
      ref={containerRef}
      data-terminal
      className="relative h-full w-full"
      style={{ background: theme?.background, padding: "8px 12px" }}
    >
      {/*
        xterm's DOM renderer makes `.xterm-rows` `pointer-events: none` and lets the `.xterm-screen`
        overlay (painted on top) capture every pointer event. That is fine for xterm's own selection
        (events still bubble to the terminal root), but it hides the DOM text from the pointer, so a
        double click on a row is swallowed by the overlay. Let the rows capture the pointer again and
        stop the overlay from intercepting; xterm keeps handling selection through the root listener.
      */}
      <style>{`
        [data-terminal] .xterm-screen { pointer-events: none; }
        [data-terminal] .xterm-rows { pointer-events: auto !important; }
      `}</style>
      {search && (
        <TerminalSearch
          search={search}
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          onFocusTerminal={() => term?.textarea?.focus()}
        />
      )}
    </div>
  );
}
