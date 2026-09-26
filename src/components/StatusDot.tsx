import { cn } from "@/lib/utils";

export type Status = "online" | "connecting" | "offline" | "error" | "unknown";

const DOT_CLASSES: Record<Status, string> = {
  online: "bg-status-online",
  connecting: "bg-status-connecting",
  offline: "bg-status-offline",
  error: "bg-destructive",
  unknown: "bg-transparent ring-1 ring-inset ring-status-offline",
};

interface StatusDotProps {
  status: Status;
  /** Translated, human-readable status. Required: color alone must never carry meaning. */
  label: string;
  className?: string;
}

export function StatusDot({ status, label, className }: StatusDotProps) {
  return (
    <span
      role="img"
      aria-label={label}
      className={cn("relative inline-flex size-2 shrink-0", className)}
    >
      {status === "connecting" && (
        <span className="absolute inset-0 rounded-full bg-status-connecting animate-tunl-pulse motion-reduce:animate-none" />
      )}
      <span className={cn("relative inline-flex size-2 rounded-full", DOT_CLASSES[status])} />
    </span>
  );
}
