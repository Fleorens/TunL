import { FolderTree, type LucideProps, Monitor, SquareTerminal } from "lucide-react";
import { cn } from "@/lib/utils";

export type Protocol = "ssh" | "rdp" | "sftp";

const ICONS = { ssh: SquareTerminal, rdp: Monitor, sftp: FolderTree } as const;

const COLOR_CLASSES: Record<Protocol, string> = {
  ssh: "text-protocol-ssh",
  rdp: "text-protocol-rdp",
  sftp: "text-protocol-sftp",
};

export function ProtocolIcon({
  protocol,
  className,
  ...props
}: { protocol: Protocol } & LucideProps) {
  const Icon = ICONS[protocol];
  return (
    <Icon
      aria-hidden="true"
      className={cn("size-4 shrink-0", COLOR_CLASSES[protocol], className)}
      {...props}
    />
  );
}
