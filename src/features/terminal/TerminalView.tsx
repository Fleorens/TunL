import { useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";
import { useSettings } from "@/features/settings/store";
import type { TerminalPort } from "@/features/terminal/port";
import { type TerminalKeyAction, zoomFontSize } from "@/features/terminal/terminal-keys";
import { resolveTerminalTheme } from "@/features/terminal/themes";
import { useXterm } from "@/features/terminal/use-xterm";
import { writeClipboardText } from "@/lib/clipboard";
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
  const baseFontSize = terminal?.fontSize ?? 13;
  const [fontSize, setFontSize] = useState(baseFontSize);
  const [searchOpen, setSearchOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // A new global size (or the settings loading after mount) resets this terminal's own zoom.
  useEffect(() => {
    setFontSize(baseFontSize);
  }, [baseFontSize]);

  const { term, search, paste } = useXterm({
    port,
    containerRef,
    settings: terminal ?? null,
    resolvedTheme,
    fontSize,
    active,
    onAction: (action: TerminalKeyAction) => {
      switch (action) {
        case "copy": {
          const selection = term?.getSelection() ?? "";
          if (selection.length > 0) {
            writeClipboardText(selection).catch(notifyError);
          }
          break;
        }
        case "paste":
          paste();
          break;
        case "search":
          setSearchOpen(true);
          break;
        case "zoomIn":
          setFontSize((current) => zoomFontSize(current, "in", baseFontSize));
          break;
        case "zoomOut":
          setFontSize((current) => zoomFontSize(current, "out", baseFontSize));
          break;
        case "zoomReset":
          setFontSize((current) => zoomFontSize(current, "reset", baseFontSize));
          break;
      }
    },
  });

  const theme = terminal ? resolveTerminalTheme(terminal.theme, resolvedTheme === "dark") : null;

  return (
    // `isolate`: xterm's own layers carry z-indexes (the WebGL link layer, the helpers); without a stacking
    // context of its own they painted over the session cards and took their clicks (lot 5 review, real app only).
    <div
      data-terminal
      className="relative isolate h-full w-full"
      style={{ background: theme?.background, padding: "8px 12px" }}
    >
      <div ref={containerRef} className="h-full w-full" />
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
