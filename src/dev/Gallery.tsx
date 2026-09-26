import { useEffect, useState } from "react";
import { Logo, Wordmark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { AtomsSection } from "@/dev/gallery/AtomsSection";
import { ColorsSection } from "@/dev/gallery/ColorsSection";
import { ControlsSection } from "@/dev/gallery/ControlsSection";
import { OverlaysSection } from "@/dev/gallery/OverlaysSection";
import { TypographySection } from "@/dev/gallery/TypographySection";
import { applyTheme, type ThemeMode } from "@/lib/theme";

const THEMES: ThemeMode[] = ["system", "dark", "light"];

export function Gallery() {
  const [mode, setMode] = useState<ThemeMode>("system");

  useEffect(() => applyTheme(mode), [mode]);

  return (
    <div className="bg-background text-foreground">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border glass px-4 py-3">
        <Logo size={28} />
        <Wordmark />
        <h1 className="ml-2 text-lg font-semibold tracking-tight">Design system</h1>
        <div className="ml-auto flex items-center gap-2">
          {THEMES.map((m) => (
            <Button
              key={m}
              variant={mode === m ? "default" : "outline"}
              size="sm"
              onClick={() => setMode(m)}
            >
              {m === "system" ? "System" : m === "dark" ? "Dark" : "Light"}
            </Button>
          ))}
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-10 p-8">
        <ColorsSection />
        <TypographySection />
        <ControlsSection />
        <AtomsSection />
        <OverlaysSection />
      </main>
    </div>
  );
}
