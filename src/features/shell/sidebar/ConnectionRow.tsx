import { Waypoints } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ProtocolIcon } from "@/components/ProtocolIcon";
import { StatusDot } from "@/components/StatusDot";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DemoConnection } from "@/features/shell/demo-data";
import { cn } from "@/lib/utils";

interface ConnectionRowProps {
  connection: DemoConnection;
  selected: boolean;
  onSelect: () => void;
}

export function ConnectionRow({ connection, selected, onSelect }: ConnectionRowProps) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter") onSelect();
      }}
      onDoubleClick={() => onSelect()}
      aria-pressed={selected}
      className={cn(
        "group/row relative flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors duration-120 hover:bg-sidebar-accent",
        selected && "bg-sidebar-accent",
      )}
    >
      {selected && (
        <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-primary" />
      )}
      <ProtocolIcon protocol={connection.protocol} className="size-3.5" />
      <span className="flex-1 truncate">{connection.name}</span>
      {connection.jumpHostName && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex size-3 text-subtle-foreground">
              <Waypoints className="size-3" />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {t("sidebar.viaBastion", { name: connection.jumpHostName })}
          </TooltipContent>
        </Tooltip>
      )}
      <StatusDot status={connection.status} label={t(`status.${connection.status}`)} />
    </button>
  );
}
