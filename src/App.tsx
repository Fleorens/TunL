import { I18nextProvider } from "react-i18next";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Gallery } from "@/dev/Gallery";
import { i18n } from "@/i18n";

export function App() {
  return (
    <I18nextProvider i18n={i18n}>
      <TooltipProvider delayDuration={400}>
        <Gallery />
        <Toaster position="bottom-right" />
      </TooltipProvider>
    </I18nextProvider>
  );
}
