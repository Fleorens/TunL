import { FolderTree, Pencil, Plug } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Connection } from "@/bindings/Connection";
import { ProtocolBadge } from "@/components/ProtocolBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ConnectionStatusDot } from "@/features/reachability/ConnectionStatusDot";
import { openSession } from "@/features/sessions/open-session";
import { useUi } from "@/features/shell/ui-store";
import { cn } from "@/lib/utils";
import { connectionAddress } from "./home-model";

interface ConnectionCardProps {
  connection: Connection;
  /** The jump host's name, or `null` when this connection is direct. */
  jumpHostName: string | null;
}

/**
 * A favorite or recent connection on the home screen. The whole card is one
 * button that opens the connection; the hover actions sit on top of it.
 */
export function ConnectionCard({ connection, jumpHostName }: ConnectionCardProps) {
  const { t } = useTranslation();
  const protocol = connection.settings.protocol;
  const connectLabel = t("home.card.connect", { name: connection.name });

  return (
    <article
      aria-label={connection.name}
      className={cn(
        "group relative rounded-xl border bg-card p-4 duration-120 ease-out-soft",
        "hover:-translate-y-px hover:border-border-strong hover:shadow-elevated",
      )}
    >
      <button
        type="button"
        className="flex w-full flex-col gap-2 text-left after:absolute after:inset-0 after:rounded-xl"
        aria-label={connection.name}
        onClick={() => openSession(connection)}
      >
        <div className="flex items-center justify-between">
          <ProtocolBadge protocol={protocol} />
          {/* The hover actions take this corner: the dot hides instead of sitting under them. */}
          <ConnectionStatusDot
            connectionId={connection.id}
            className="group-hover:invisible group-focus-within:invisible"
          />
        </div>
        <span className="font-medium truncate">{connection.name}</span>
        <span className="truncate font-mono text-xs text-muted-foreground">
          {connectionAddress(connection)}
        </span>
        {jumpHostName && (
          <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
            <span aria-hidden>⤷</span>
            <span className="truncate">{jumpHostName}</span>
          </span>
        )}
        <div className="flex flex-wrap gap-1">
          {connection.tags.slice(0, 3).map((tag) => (
            <Badge key={tag} variant="outline">
              #{tag}
            </Badge>
          ))}
        </div>
      </button>

      <div className="absolute right-2 top-2 z-10 hidden items-center gap-0.5 group-hover:flex group-focus-within:flex">
        <Action
          ariaLabel={connectLabel}
          onClick={() => openSession(connection)}
          icon={<Plug className="size-4" />}
        />
        {protocol === "ssh" && (
          <Action
            ariaLabel={t("home.card.sftp", { name: connection.name })}
            onClick={() => openSession(connection, "sftp")}
            icon={<FolderTree className="size-4" />}
          />
        )}
        <Action
          ariaLabel={t("home.card.edit", { name: connection.name })}
          onClick={() => useUi.getState().openEditor({ mode: "edit", id: connection.id })}
          icon={<Pencil className="size-4" />}
        />
      </div>
    </article>
  );
}

/** A single hover action: an icon with a translated `aria-label` and tooltip. */
function Action({
  ariaLabel,
  onClick,
  icon,
}: {
  ariaLabel: string;
  onClick: () => void;
  icon: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="h-8 w-8"
          aria-label={ariaLabel}
          onClick={onClick}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{ariaLabel}</TooltipContent>
    </Tooltip>
  );
}
