import { MotionConfig } from "motion/react";
import { useEffect } from "react";
import { I18nextProvider } from "react-i18next";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Gallery } from "@/dev/Gallery";
import { AppLayout } from "@/features/shell/AppLayout";
import { i18n } from "@/i18n";
import { applyTheme } from "@/lib/theme";

const showGallery = import.meta.env.DEV && window.location.hash === "#gallery";

export function App() {
  useEffect(() => applyTheme("system"), []);
  return (
    <I18nextProvider i18n={i18n}>
      <MotionConfig reducedMotion="user">
        <TooltipProvider delayDuration={400}>
          {showGallery ? <Gallery /> : <AppLayout />}
          <Toaster position="bottom-right" />
        </TooltipProvider>
      </MotionConfig>
    </I18nextProvider>
  );
}
