import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Gallery } from "@/dev/Gallery";

export function App() {
  return (
    <TooltipProvider delayDuration={400}>
      <Gallery />
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}
