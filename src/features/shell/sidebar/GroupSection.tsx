import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ACCENT_DOT_CLASSES, type AccentColor } from "@/lib/colors";
import { cn } from "@/lib/utils";

interface GroupSectionProps {
  title: string;
  color: AccentColor;
  count: number;
  children: ReactNode;
}

export function GroupSection({ title, color, count, children }: GroupSectionProps) {
  const [open, setOpen] = useState(true);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex h-7 w-full items-center gap-2 px-2 text-left text-sm select-none"
        >
          <ChevronRight
            className={cn("size-3 shrink-0 transition-transform duration-120", open && "rotate-90")}
          />
          <span className={cn("size-2 rounded-full", ACCENT_DOT_CLASSES[color])} />
          <span className="text-xs font-medium">{title}</span>
          <span className="ml-auto text-xs text-subtle-foreground tabular-nums">{count}</span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-0.5">{children}</CollapsibleContent>
    </Collapsible>
  );
}
