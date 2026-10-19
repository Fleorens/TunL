import { Waypoints } from "lucide-react";
import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import type { Connection } from "@/bindings/Connection";
import { ProtocolIcon } from "@/components/ProtocolIcon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ConnectionStatusDot } from "@/features/reachability/ConnectionStatusDot";
import { cn } from "@/lib/utils";

interface ConnectionRowProps extends ComponentProps<"button"> {
  connection: Connection;
  jumpHostName: string | null;
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
  jumpHostName,
  selected,
  onSelect,
  onActivate,
  className,
  onClick,
  onKeyDown,
  ...buttonProps
}: ConnectionRowProps) {
  const { t } = useTranslation();
  const protocol = connection.settings.protocol;

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
      {selected && <span className="absolute inset-y-0 left-0 w-0.5 rounded-full bg-primary" />}
      <ProtocolIcon protocol={protocol} className="size-3.5" />
      <span className="flex-1 truncate">{connection.name}</span>
      {jumpHostName && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex size-3 shrink-0 text-subtle-foreground">
              <Waypoints className="size-3" />
            </span>
          </TooltipTrigger>
          <TooltipContent>{t("sidebar.viaBastion", { name: jumpHostName })}</TooltipContent>
        </Tooltip>
      )}
      <ConnectionStatusDot connectionId={connection.id} />
    </button>
  );
}
