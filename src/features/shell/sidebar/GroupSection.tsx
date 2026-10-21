import { ChevronDown, ChevronRight, ChevronUp, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Group } from "@/bindings/Group";
import { IconButton } from "@/components/IconButton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ACCENT_DOT_CLASSES } from "@/lib/colors";
import { cn } from "@/lib/utils";

interface GroupSectionProps {
  group: Group;
  /** Zero-based position among all groups; disables Move up on the first, Move down on the last. */
  index: number;
  /** Total number of groups. */
  groupCount: number;
  /** Connections in this group, shown in the header counter (0 for an empty group). */
  count: number;
  children: React.ReactNode;
  onRename: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}

export function GroupSection({
  group,
  index,
  groupCount,
  count,
  children,
  onRename,
  onMoveUp,
  onMoveDown,
  onDelete,
}: GroupSectionProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);

  const dotClass = ACCENT_DOT_CLASSES[group.color ?? "slate"];

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="group/header flex h-7 items-center gap-2 px-2 text-left text-sm">
        <CollapsibleTrigger asChild>
          <button type="button" className="flex flex-1 items-center gap-2 select-none">
            <ChevronRight
              className="size-3 shrink-0 transition-transform duration-120"
              style={{ transform: open ? "rotate(90deg)" : undefined }}
            />
            <span className={cn("size-2 rounded-full", dotClass)} />
            <span className="flex-1 truncate text-left text-xs font-medium">{group.name}</span>
            <span className="text-xs text-subtle-foreground tabular-nums">{count}</span>
          </button>
        </CollapsibleTrigger>

        <div className="relative ml-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                variant="ghost"
                size="md"
                label={t("sidebar.groupActions")}
                className="size-6 opacity-0 group-hover/header:opacity-100 focus-visible:opacity-100"
              >
                <MoreHorizontal className="size-4" />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={onRename}>
                  <Pencil className="size-3.5" />
                  {t("groupMenu.rename")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onMoveUp} disabled={index === 0}>
                  <ChevronUp className="size-3.5" />
                  {t("groupMenu.moveUp")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onMoveDown} disabled={index === groupCount - 1}>
                  <ChevronDown className="size-3.5" />
                  {t("groupMenu.moveDown")}
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onDelete} variant="destructive">
                <Trash2 className="size-3.5" />
                {t("groupMenu.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <CollapsibleContent className="flex flex-col gap-0.5">{children}</CollapsibleContent>
    </Collapsible>
  );
}
