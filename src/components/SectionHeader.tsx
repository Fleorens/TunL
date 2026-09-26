import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SectionHeaderProps {
  title: string;
  action?: ReactNode;
  className?: string;
}

export function SectionHeader({ title, action, className }: SectionHeaderProps) {
  return (
    <div className={cn("flex h-7 items-center justify-between px-2", className)}>
      <h3 className="text-xs font-medium uppercase tracking-wider text-subtle-foreground">
        {title}
      </h3>
      {action}
    </div>
  );
}
