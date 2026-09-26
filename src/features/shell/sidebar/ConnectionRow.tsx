import { Waypoints } from "lucide-react";
import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { ProtocolIcon } from "@/components/ProtocolIcon";
import { StatusDot } from "@/components/StatusDot";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DemoConnection } from "@/features/shell/demo-data";
import { cn } from "@/lib/utils";

interface ConnectionRowProps extends ComponentProps<"button"> {
  connection: DemoConnection;
  selected: boolean;
  /** Single click: highlight the row. */
  onSelect: () => void;
  /** Double click or Enter: run the default action (connect). */
  onActivate: () => void;
}

/**
 * Extra button props are forwarded on purpose: `ContextMenuTrigger asChild` injects its
 * handlers (onContextMenu, pointer events, ref…) through them. Dropping them breaks the menu.
 */
export function ConnectionRow({
  connection,
  selected,
  onSelect,
  onActivate,
  className,
  onClick,
  onKeyDown,
  ...buttonProps
}: ConnectionRowProps) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      {...buttonProps}
      aria-current={selected || undefined}
      onClick={(event) => {
        onClick?.(event);
        onSelect();
      }}
      onDoubleClick={onActivate}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.key === "Enter") {
          event.preventDefault();
          onActivate();
        }
      }}
      className={cn(
        "group/row relative flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors duration-120 hover:bg-sidebar-accent",
        selected && "bg-sidebar-accent",
        className,
      )}
    >
      {selected && (
        <span className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-primary" />
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
