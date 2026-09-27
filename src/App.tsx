import { MotionConfig } from "motion/react";
import { useEffect } from "react";
import { I18nextProvider } from "react-i18next";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Gallery } from "@/dev/Gallery";
import { useConnections } from "@/features/connections/store";
import { useSettings } from "@/features/settings/store";
import { useApplySettings } from "@/features/settings/use-apply-settings";
import { AppLayout } from "@/features/shell/AppLayout";
import { i18n } from "@/i18n";

const showGallery = import.meta.env.DEV && window.location.hash === "#gallery";

export function App() {
  // Applies theme, language and animation settings as they load; returns the MotionConfig value.
  const reduceMotion = useApplySettings();

  // One-shot load of the two stores on first render.
  useEffect(() => {
    void useConnections.getState().load();
    void useSettings.getState().load();
  }, []);

  return (
    <I18nextProvider i18n={i18n}>
      <MotionConfig reducedMotion={reduceMotion}>
        <TooltipProvider delayDuration={400}>
          {showGallery ? <Gallery /> : <AppLayout />}
          <Toaster position="bottom-right" />
        </TooltipProvider>
      </MotionConfig>
    </I18nextProvider>
  );
}
