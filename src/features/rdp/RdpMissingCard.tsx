// The RDP tab without a FreeRDP 3 client: say how to install one, per distribution family, then retry or close.
import { MonitorX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";

/** The FreeRDP 3 install command per family of distributions, so the card can offer the right one. */
export const INSTALL_COMMANDS = [
  { distro: "Debian, Ubuntu", command: "sudo apt install freerdp3-sdl" },
  { distro: "Fedora", command: "sudo dnf install freerdp" },
  { distro: "Arch Linux", command: "sudo pacman -S freerdp" },
  { distro: "openSUSE", command: "sudo zypper install freerdp" },
] as const;

/** The RDP card when no FreeRDP 3 client is found: install one, then retry or close the tab. */
export function RdpMissingCard({
  onRetry,
  onClose,
}: {
  onRetry: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      aria-live="polite"
      className="mx-auto flex w-110 max-w-full flex-col rounded-xl border bg-card shadow-elevated p-6"
    >
      <div className="flex items-center gap-2">
        <MonitorX className="size-5 text-destructive" aria-hidden />
        <p className="text-sm font-medium">{t("rdp.missing.title")}</p>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{t("rdp.missing.description")}</p>
      <ul className="mt-4 flex flex-col gap-2">
        {INSTALL_COMMANDS.map(({ distro, command }) => (
          <InstallRow key={distro} distro={distro} command={command} />
        ))}
      </ul>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose}>
          {t("rdp.card.closeTab")}
        </Button>
        <Button size="sm" onClick={onRetry}>
          {t("sessions.error.retry")}
        </Button>
      </div>
    </div>
  );
}

/** One distribution: its name, the command in `code`, and a button that copies it. */
function InstallRow({ distro, command }: { distro: string; command: string }) {
  const { t } = useTranslation();
  return (
    <li className="flex items-center justify-between gap-2 rounded-lg border bg-card p-2">
      <div className="min-w-0">
        <p className="text-sm font-medium">{distro}</p>
        <code className="text-sm font-mono text-muted-foreground">{command}</code>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={async () => {
          await copyText(command);
        }}
      >
        {t("rdp.missing.copy", { distro })}
      </Button>
    </li>
  );
}
