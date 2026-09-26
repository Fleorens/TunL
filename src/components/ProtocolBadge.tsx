import type { Protocol } from "@/components/ProtocolIcon";
import { cn } from "@/lib/utils";

const BADGE_CLASSES: Record<Protocol, string> = {
  ssh: "bg-protocol-ssh/12 text-protocol-ssh",
  rdp: "bg-protocol-rdp/12 text-protocol-rdp",
  sftp: "bg-protocol-sftp/12 text-protocol-sftp",
};

interface ProtocolBadgeProps {
  protocol: Protocol;
  className?: string;
}

export function ProtocolBadge({ protocol, className }: ProtocolBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-1.5 py-0.5 font-mono text-[10px] leading-none font-semibold uppercase tracking-wide",
        BADGE_CLASSES[protocol],
        className,
      )}
    >
      {protocol}
    </span>
  );
}
