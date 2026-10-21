// The window buttons TunL draws at the right of its own title bar (T35): minimize, maximize or restore, close.
// Shown in the TopBar only when the window dropped its decorations; the buttons go through `getCurrentWindow()`
// (ipc.ts), which is a no-op outside Tauri.

import { Copy, Minus, Square, X } from "lucide-react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/IconButton";
import { useUi } from "@/features/shell/ui-store";
import { ipc } from "@/lib/ipc";

export function WindowControls(): JSX.Element {
  const { t } = useTranslation();
  const maximized = useUi((state) => state.maximized);

  return (
    <fieldset className="flex items-center gap-1 m-0 border-0 p-0">
      <legend className="sr-only">{t("window.controls")}</legend>
      <IconButton label={t("window.minimize")} onClick={() => ipc.windowMinimize()}>
        <Minus className="size-4" />
      </IconButton>

      <IconButton
        label={maximized ? t("window.restore") : t("window.maximize")}
        onClick={() => ipc.windowToggleMaximize()}
      >
        {maximized ? <Copy className="size-4" /> : <Square className="size-4" />}
      </IconButton>

      <IconButton
        label={t("window.close")}
        className="hover:bg-destructive/10 hover:text-destructive"
        onClick={() => ipc.windowClose()}
      >
        <X className="size-4" />
      </IconButton>
    </fieldset>
  );
}
