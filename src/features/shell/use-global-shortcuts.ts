import { useEffect, useRef } from "react";
import { matchShortcut, type ShortcutId } from "./shortcuts";

export type ShortcutHandlers = Partial<Record<ShortcutId, () => void>>;

/** Listens in the capture phase so shortcuts win over focused widgets (xterm included). */
export function useGlobalShortcuts(handlers: ShortcutHandlers): void {
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const inTerminal =
        event.target instanceof Element && event.target.closest("[data-terminal]") !== null;
      const id = matchShortcut(event, inTerminal);
      const handler = id ? handlersRef.current[id] : undefined;
      if (!handler) return;
      event.preventDefault();
      event.stopPropagation();
      handler();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, []);
}
