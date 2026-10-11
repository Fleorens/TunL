import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { SectionHeader } from "@/components/SectionHeader";
import { TerminalView } from "@/features/terminal/TerminalView";
import { createEchoPort } from "./echo-port";

/**
 * The terminal in the design gallery. It is wired to a local echo port (`echo-port.ts`), so it can
 * be exercised in the browser: type, zoom, `Ctrl+Shift+F`.
 */
export function TerminalSection() {
  const { t } = useTranslation();
  // One port for the life of the section. Its banner is kept until the first subscription only: a
  // later remount of the view starts from an empty screen.
  const port = useMemo(() => createEchoPort(), []);

  return (
    <section aria-label={t("terminal.title")} className="space-y-4">
      <SectionHeader title={t("terminal.title")} />
      <div className="h-80 rounded-xl border border-border bg-card p-2">
        <TerminalView port={port} active />
      </div>
    </section>
  );
}
