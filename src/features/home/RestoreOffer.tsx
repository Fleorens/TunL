// The "reopen last time's tabs" offer on the home screen (T60): a one-line banner with a primary "Reopen N
// tabs" button and a dismiss button. It sits at the top of the favorites region, in flow, so it does not move
// the quick-connect field above it.
import { RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useRestore } from "@/features/sessions/restore-store";

export function RestoreOffer() {
  const { t } = useTranslation();
  const count = useRestore((state) => state.offer.length);
  if (count === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
      <span className="flex items-center gap-2 text-sm font-medium">
        <RotateCcw className="size-4" aria-hidden />
        {t("home.restoreTabsLabel")}
      </span>
      <div className="ml-auto flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => useRestore.getState().dismissOffer()}>
          {t("home.restoreDismiss")}
        </Button>
        <Button size="sm" onClick={() => useRestore.getState().openOffer()}>
          {t("home.restoreTabs", { count })}
        </Button>
      </div>
    </div>
  );
}
